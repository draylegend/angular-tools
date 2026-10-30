use std::{env, fs};
use zed_extension_api::{self as zed, serde_json, LanguageServerId, Result};

const SERVER_PACKAGE: &str = "@angular/language-server";
// The server pins its own @angular/language-service and TypeScript, so one
// version here fixes every package that gets installed.
const SERVER_VERSION: &str = "22.2.3";
const SERVER_PATH: &str = "node_modules/@angular/language-server/index.js";
// Installed with the server; the package is also a tsserver plugin.
const SERVICE_PACKAGE: &str = "@angular/language-service";
// The extension's own tsserver plugin and server proxy, written into the
// work directory.
const PLUGIN_PACKAGE: &str = "angular-tools";
const PLUGIN_DIR: &str = "plugin";
const PLUGIN_FILES: [(&str, &str); 4] = [
    ("package.json", include_str!("../plugin/package.json")),
    ("index.js", include_str!("../plugin/index.js")),
    (
        "selector-rename.js",
        include_str!("../plugin/selector-rename.js"),
    ),
    (
        "ngserver-proxy.js",
        include_str!("../plugin/ngserver-proxy.js"),
    ),
];

struct AngularToolsExtension {
    server_ready: bool,
}

impl AngularToolsExtension {
    fn server_exists() -> bool {
        fs::metadata(SERVER_PATH).is_ok_and(|stat| stat.is_file())
    }

    fn install_server(&mut self, language_server_id: &LanguageServerId) -> Result<()> {
        if self.server_ready && Self::server_exists() {
            return Ok(());
        }

        zed::set_language_server_installation_status(
            language_server_id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );
        let installed = zed::npm_package_installed_version(SERVER_PACKAGE)?;
        if !Self::server_exists() || installed.as_deref() != Some(SERVER_VERSION) {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            if let Err(error) = zed::npm_install_package(SERVER_PACKAGE, SERVER_VERSION) {
                zed::set_language_server_installation_status(
                    language_server_id,
                    &zed::LanguageServerInstallationStatus::Failed(error.clone()),
                );
                return Err(error);
            }
            if !Self::server_exists() {
                return Err(format!(
                    "installed package '{SERVER_PACKAGE}' did not contain '{SERVER_PATH}'"
                ));
            }
        }

        zed::set_language_server_installation_status(
            language_server_id,
            &zed::LanguageServerInstallationStatus::None,
        );
        self.server_ready = true;
        Ok(())
    }

    /// Writes the plugin and the proxy into `plugin/node_modules/angular-tools`,
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

/// Arguments the official VS Code client passes with its default settings.
/// The server resolves TypeScript and @angular/language-service from the
/// probe locations, in order.
fn server_args(probe_locations: &str) -> Vec<String> {
    [
        "--stdio",
        "--tsProbeLocations",
        probe_locations,
        "--ngProbeLocations",
        probe_locations,
        "--includeAutomaticOptionalChainCompletions",
        "--includeCompletionsWithSnippetText",
    ]
    .map(String::from)
    .to_vec()
}

impl zed::Extension for AngularToolsExtension {
    fn new() -> Self {
        Self {
            server_ready: false,
        }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        self.install_server(language_server_id)?;
        Self::install_plugin()?;
        let work_dir = env::current_dir().map_err(|error| error.to_string())?;
        let probe_locations = format!("{},{}", work_dir.to_string_lossy(), worktree.root_path());
        // The proxy starts the server and answers rename, find references and
        // go to definition on selector names in HTML.
        let proxy = work_dir.join(format!(
            "{PLUGIN_DIR}/node_modules/{PLUGIN_PACKAGE}/ngserver-proxy.js"
        ));
        let mut args = vec![
            proxy.to_string_lossy().into_owned(),
            work_dir.join(SERVER_PATH).to_string_lossy().into_owned(),
        ];
        args.extend(server_args(&probe_locations));

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args,
            env: Default::default(),
        })
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
        if target_language_server_id.as_ref() != "vtsls" || !is_angular_worktree(worktree) {
            return Ok(None);
        }
        self.install_server(language_server_id)?;
        Self::install_plugin()?;
        let work_dir = env::current_dir().map_err(|error| error.to_string())?;
        // The extension's plugin comes last, so it wraps the Angular one and
        // answers selector requests on top of it.
        Ok(Some(serde_json::json!({
            "vtsls": {
                "tsserver": {
                    "globalPlugins": [
                        {
                            "name": SERVICE_PACKAGE,
                            "location": work_dir.join("node_modules").to_string_lossy(),
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
