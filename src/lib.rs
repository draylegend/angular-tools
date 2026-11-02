use std::{collections::HashSet, env, fs};
use zed_extension_api::{self as zed, serde_json, LanguageServerId, Result};

const SERVER_PACKAGE: &str = "@angular/language-server";
// The server's major version follows Angular's from 11 on. Projects that name
// no such version in package.json get the latest server known to work.
const FIRST_SERVER_MAJOR: u32 = 11;
const DEFAULT_SERVER_MAJOR: u32 = 22;
// Installed with the server; the package is also a tsserver plugin.
const SERVICE_PACKAGE: &str = "@angular/language-service";
// Formats templates in projects that do not have their own Prettier.
const PRETTIER_PACKAGE: &str = "prettier";
const PRETTIER_VERSION: &str = "3.9.10";
// Expands Emmet abbreviations in inline templates.
const EMMET_SERVER_ID: &str = "angular-tools-emmet";
const EMMET_PACKAGE: &str = "@olrtg/emmet-language-server";
const EMMET_VERSION: &str = "2.8.0";
const EMMET_PATH: &str = "node_modules/@olrtg/emmet-language-server/dist/index.js";
// Completes Tailwind classes in files of the Angular language, which Zed's own
// Tailwind server does not cover. Its settings apply here too.
const TAILWIND_SERVER_ID: &str = "angular-tools-tailwind";
const TAILWIND_ZED_SERVER: &str = "tailwindcss-language-server";
const TAILWIND_PACKAGE: &str = "@tailwindcss/language-server";
const TAILWIND_VERSION: &str = "0.16.0";
const TAILWIND_PATH: &str =
    "node_modules/@tailwindcss/language-server/bin/tailwindcss-language-server";
// Completes plain HTML tags and attributes in files of the Angular language and
// in inline templates, which the Angular Language Server leaves out.
const HTML_SERVER_ID: &str = "angular-tools-html";
const HTML_PACKAGE: &str = "vscode-html-languageservice";
const HTML_VERSION: &str = "5.6.2";
const HTML_PATH: &str = "node_modules/vscode-html-languageservice/lib/umd/htmlLanguageService.js";
// The extension's own tsserver plugin and server proxies, written into the
// work directory.
const PLUGIN_PACKAGE: &str = "angular-tools";
const PLUGIN_DIR: &str = "plugin";
const PLUGIN_FILES: [(&str, &str); 9] = [
    ("package.json", include_str!("../plugin/package.json")),
    ("index.js", include_str!("../plugin/index.js")),
    ("lsp.js", include_str!("../plugin/lsp.js")),
    (
        "selector-rename.js",
        include_str!("../plugin/selector-rename.js"),
    ),
    (
        "ngserver-proxy.js",
        include_str!("../plugin/ngserver-proxy.js"),
    ),
    ("emmet-proxy.js", include_str!("../plugin/emmet-proxy.js")),
    ("no-server.js", include_str!("../plugin/no-server.js")),
    ("template.js", include_str!("../plugin/template.js")),
    ("html-server.js", include_str!("../plugin/html-server.js")),
];

struct AngularToolsExtension {
    ready_majors: HashSet<u32>,
}

/// Each major version of the server is installed under its own npm alias, so
/// projects on different Angular versions keep their servers side by side.
fn server_alias(major: u32) -> String {
    format!("angular-language-server-{major}")
}

fn server_dir(major: u32) -> String {
    format!("node_modules/{}", server_alias(major))
}

fn server_path(major: u32) -> String {
    format!("{}/index.js", server_dir(major))
}

impl AngularToolsExtension {
    fn server_exists(major: u32) -> bool {
        fs::metadata(server_path(major)).is_ok_and(|stat| stat.is_file())
    }

    /// Installs the latest server of the given major version once.
    fn install_server(&mut self, language_server_id: &LanguageServerId, major: u32) -> Result<()> {
        if self.ready_majors.contains(&major) && Self::server_exists(major) {
            return Ok(());
        }

        if !Self::server_exists(major) {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            let version = format!("npm:{SERVER_PACKAGE}@^{major}.0.0");
            if let Err(error) = zed::npm_install_package(&server_alias(major), &version) {
                zed::set_language_server_installation_status(
                    language_server_id,
                    &zed::LanguageServerInstallationStatus::Failed(error.clone()),
                );
                return Err(error);
            }
            if !Self::server_exists(major) {
                return Err(format!(
                    "installed package '{SERVER_PACKAGE}' did not contain '{}'",
                    server_path(major)
                ));
            }
        }

        zed::set_language_server_installation_status(
            language_server_id,
            &zed::LanguageServerInstallationStatus::None,
        );
        self.ready_majors.insert(major);
        Ok(())
    }

    fn install_prettier() -> Result<()> {
        if zed::npm_package_installed_version(PRETTIER_PACKAGE)?.as_deref()
            != Some(PRETTIER_VERSION)
        {
            zed::npm_install_package(PRETTIER_PACKAGE, PRETTIER_VERSION)?;
        }
        Ok(())
    }

    /// The Emmet server behind its proxy, which answers only in inline
    /// templates. Projects without Angular get the proxy alone, which does
    /// nothing, so they install no server.
    fn emmet_command(worktree: &zed::Worktree) -> Result<zed::Command> {
        Self::install_plugin()?;
        if is_angular_worktree(worktree)
            && zed::npm_package_installed_version(EMMET_PACKAGE)?.as_deref() != Some(EMMET_VERSION)
        {
            zed::npm_install_package(EMMET_PACKAGE, EMMET_VERSION)?;
        }
        let work_dir = env::current_dir().map_err(|error| error.to_string())?;
        let proxy = work_dir.join(format!(
            "{PLUGIN_DIR}/node_modules/{PLUGIN_PACKAGE}/emmet-proxy.js"
        ));
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![
                proxy.to_string_lossy().into_owned(),
                worktree.root_path(),
                work_dir.join(EMMET_PATH).to_string_lossy().into_owned(),
                "--stdio".to_string(),
            ],
            env: Default::default(),
        })
    }

    /// The Tailwind server in projects that use Tailwind. Others get a stand-in
    /// that does nothing, so they install no server.
    fn tailwind_command(worktree: &zed::Worktree) -> Result<zed::Command> {
        Self::install_plugin()?;
        let work_dir = env::current_dir().map_err(|error| error.to_string())?;
        let uses_tailwind = worktree
            .read_text_file("package.json")
            .is_ok_and(|package| package.contains("\"tailwindcss\""));
        let args = if uses_tailwind {
            if zed::npm_package_installed_version(TAILWIND_PACKAGE)?.as_deref()
                != Some(TAILWIND_VERSION)
            {
                zed::npm_install_package(TAILWIND_PACKAGE, TAILWIND_VERSION)?;
            }
            vec![
                work_dir.join(TAILWIND_PATH).to_string_lossy().into_owned(),
                "--stdio".to_string(),
            ]
        } else {
            let stand_in = format!("{PLUGIN_DIR}/node_modules/{PLUGIN_PACKAGE}/no-server.js");
            vec![work_dir.join(stand_in).to_string_lossy().into_owned()]
        };
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args,
            env: Default::default(),
        })
    }

    /// The HTML completion server. Projects without Angular get it without the
    /// language service, so it does nothing and they install nothing.
    fn html_command(worktree: &zed::Worktree) -> Result<zed::Command> {
        Self::install_plugin()?;
        if is_angular_worktree(worktree)
            && zed::npm_package_installed_version(HTML_PACKAGE)?.as_deref() != Some(HTML_VERSION)
        {
            zed::npm_install_package(HTML_PACKAGE, HTML_VERSION)?;
        }
        let work_dir = env::current_dir().map_err(|error| error.to_string())?;
        let server = work_dir.join(format!(
            "{PLUGIN_DIR}/node_modules/{PLUGIN_PACKAGE}/html-server.js"
        ));
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![
                server.to_string_lossy().into_owned(),
                worktree.root_path(),
                work_dir.join(HTML_PATH).to_string_lossy().into_owned(),
            ],
            env: Default::default(),
        })
    }

    /// Writes the plugin and the proxies into `plugin/node_modules/angular-tools`,
    /// where tsserver resolves the plugin from the `plugin` probe location.
    fn install_plugin() -> Result<()> {
        let dir = format!("{PLUGIN_DIR}/node_modules/{PLUGIN_PACKAGE}");
        fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
        for (name, content) in PLUGIN_FILES {
            let path = format!("{dir}/{name}");
            if fs::read_to_string(&path).ok().as_deref() != Some(content) {
                fs::write(&path, content).map_err(|error| error.to_string())?;
            }
        }
        Ok(())
    }
}

fn is_angular_worktree(worktree: &zed::Worktree) -> bool {
    worktree.read_text_file("angular.json").is_ok()
        || worktree
            .read_text_file("package.json")
            .is_ok_and(|package| package.contains("\"@angular/core\""))
}

/// The major version of `@angular/core` in the project's package.json, such
/// as 21 for `^21.2.0`.
fn angular_major(worktree: &zed::Worktree) -> u32 {
    let package = worktree.read_text_file("package.json").unwrap_or_default();
    let package: serde_json::Value = serde_json::from_str(&package).unwrap_or_default();
    ["dependencies", "devDependencies"]
        .iter()
        .find_map(|field| package[field]["@angular/core"].as_str())
        .and_then(|range| {
            range
                .chars()
                .skip_while(|char| !char.is_ascii_digit())
                .take_while(char::is_ascii_digit)
                .collect::<String>()
                .parse()
                .ok()
        })
        .filter(|major| *major >= FIRST_SERVER_MAJOR)
        .unwrap_or(DEFAULT_SERVER_MAJOR)
}

/// Arguments the official VS Code client passes with its default settings.
/// The proxy adds the probe locations, where the server looks for TypeScript
/// and @angular/language-service.
fn server_args() -> Vec<String> {
    [
        "--stdio",
        "--includeAutomaticOptionalChainCompletions",
        "--includeCompletionsWithSnippetText",
    ]
    .map(String::from)
    .to_vec()
}

impl zed::Extension for AngularToolsExtension {
    fn new() -> Self {
        Self {
            ready_majors: HashSet::new(),
        }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        if language_server_id.as_ref() == EMMET_SERVER_ID {
            return Self::emmet_command(worktree);
        }
        if language_server_id.as_ref() == TAILWIND_SERVER_ID {
            return Self::tailwind_command(worktree);
        }
        if language_server_id.as_ref() == HTML_SERVER_ID {
            return Self::html_command(worktree);
        }
        let major = angular_major(worktree);
        self.install_server(language_server_id, major)?;
        Self::install_plugin()?;
        if is_angular_worktree(worktree) {
            Self::install_prettier()?;
        }
        let work_dir = env::current_dir().map_err(|error| error.to_string())?;
        // The proxy starts the project's own server or, without one, the
        // installed server for the project's Angular version, answers
        // rename, find references and go to definition on selector names in
        // HTML, and formats templates.
        let proxy = work_dir.join(format!(
            "{PLUGIN_DIR}/node_modules/{PLUGIN_PACKAGE}/ngserver-proxy.js"
        ));
        let mut args = vec![
            proxy.to_string_lossy().into_owned(),
            worktree.root_path(),
            work_dir
                .join(server_path(major))
                .to_string_lossy()
                .into_owned(),
        ];
        args.extend(server_args());

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args,
            env: Default::default(),
        })
    }

    /// Zed's settings of its own Tailwind server, with its default for Emmet.
    fn language_server_workspace_configuration(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<serde_json::Value>> {
        if language_server_id.as_ref() != TAILWIND_SERVER_ID {
            return Ok(None);
        }
        let mut settings = zed::settings::LspSettings::for_worktree(TAILWIND_ZED_SERVER, worktree)
            .ok()
            .and_then(|settings| settings.settings)
            .unwrap_or_else(|| serde_json::json!({}));
        if settings.get("emmetCompletions").is_none() {
            settings["emmetCompletions"] = true.into();
        }
        Ok(Some(serde_json::json!({ "tailwindCSS": settings })))
    }

    /// Loads the Angular language service and the extension's own plugin into
    /// vtsls as tsserver plugins, so TypeScript features such as rename also
    /// cover templates and selectors.
    fn language_server_additional_workspace_configuration(
        &mut self,
        language_server_id: &LanguageServerId,
        target_language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<serde_json::Value>> {
        if language_server_id.as_ref() == EMMET_SERVER_ID
            || language_server_id.as_ref() == TAILWIND_SERVER_ID
            || language_server_id.as_ref() == HTML_SERVER_ID
            || target_language_server_id.as_ref() != "vtsls"
            || !is_angular_worktree(worktree)
        {
            return Ok(None);
        }
        let major = angular_major(worktree);
        self.install_server(language_server_id, major)?;
        Self::install_plugin()?;
        let work_dir = env::current_dir().map_err(|error| error.to_string())?;
        // tsserver resolves the language service upward from the folder of
        // the server for the project's Angular version. The extension's plugin
        // comes last, so it wraps the Angular one and answers selector
        // requests on top of it.
        Ok(Some(serde_json::json!({
            "vtsls": {
                "tsserver": {
                    "globalPlugins": [
                        {
                            "name": SERVICE_PACKAGE,
                            "location": work_dir.join(server_dir(major)).to_string_lossy(),
                            "enableForWorkspaceTypeScriptVersions": true,
                        },
                        {
                            "name": PLUGIN_PACKAGE,
                            "location": work_dir.join(PLUGIN_DIR).to_string_lossy(),
                            "enableForWorkspaceTypeScriptVersions": true,
                        },
                    ],
                },
            },
        })))
    }
}

zed::register_extension!(AngularToolsExtension);
