use std::{
    collections::{HashMap, HashSet},
    env, fs,
    time::Duration,
};
use zed_extension_api::{self as zed, serde_json, LanguageServerId, Result};

const SERVER_ID: &str = "angular-tools";
const SERVER_PACKAGE: &str = "@angular/language-server";
// The server's major version follows Angular's from 11 on. Projects without
// such a version get the latest server known to work.
const FIRST_SERVER_MAJOR: u32 = 11;
const DEFAULT_SERVER_MAJOR: u32 = 22;
// How often an installed server is brought up to date within its major version.
const SERVER_UPDATE_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
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
// Tailwind does not read the class name in a binding such as `[class.flex]`.
const TAILWIND_CLASS_BINDING: &str = r"\[class\.([^\]=\s]*)";
// Nor an unquoted key in `[ngClass]="{flex: a}"`. It reads quoted ones itself.
const TAILWIND_OBJECT_BINDING: &str = r#"\[(?:ngClass|class)\]="([^"]*)"#;
const TAILWIND_OBJECT_KEY: &str = r"[{,]\s*([\w-]*)";
const TAILWIND_PACKAGE: &str = "@tailwindcss/language-server";
const TAILWIND_VERSION: &str = "0.16.0";
const TAILWIND_PATH: &str =
    "node_modules/@tailwindcss/language-server/bin/tailwindcss-language-server";
// Completes plain HTML tags and attributes and CSS in files of the Angular
// language and in inline templates, which the Angular Language Server leaves out.
const HTML_SERVER_ID: &str = "angular-tools-html";
const HTML_PACKAGE: &str = "vscode-html-languageservice";
const HTML_VERSION: &str = "5.6.2";
const HTML_PATH: &str = "node_modules/vscode-html-languageservice/lib/umd/htmlLanguageService.js";
const CSS_PACKAGE: &str = "vscode-css-languageservice";
const CSS_VERSION: &str = "6.3.10";
// The extension's own tsserver plugin and server proxies, written into the
// work directory.
const PLUGIN_PACKAGE: &str = "angular-tools";
const PLUGIN_DIR: &str = "plugin";
const PLUGIN_FILES: [(&str, &str); 11] = [
    ("package.json", include_str!("../plugin/package.json")),
    ("index.js", include_str!("../plugin/index.js")),
    ("lsp.js", include_str!("../plugin/lsp.js")),
    (
        "angular-imports.js",
        include_str!("../plugin/angular-imports.js"),
    ),
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
    ("project.js", include_str!("../plugin/project.js")),
    ("template.js", include_str!("../plugin/template.js")),
    ("html-server.js", include_str!("../plugin/html-server.js")),
];

/// What the worktree contains, found by `project.js` in nested folders too.
#[derive(Clone, Copy)]
struct Project {
    angular: bool,
    major: u32,
    tailwind: bool,
}

struct AngularToolsExtension {
    ready_majors: HashSet<u32>,
    projects: HashMap<u64, Project>,
}

/// Each major version of the server is installed under its own npm alias, so
/// projects on different Angular versions keep their servers side by side.
fn server_alias(major: u32) -> String {
    format!("angular-language-server-{major}")
}

fn server_range(major: u32) -> String {
    format!("npm:{SERVER_PACKAGE}@^{major}.0.0")
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

    /// Records an update check and tells whether the last one is old enough for
    /// another. A failed update waits for the next one too, so that working
    /// offline does not slow down every start.
    fn server_update_due(major: u32) -> bool {
        let stamp = format!("{}.checked", server_alias(major));
        let due = fs::metadata(&stamp)
            .and_then(|stat| stat.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_none_or(|elapsed| elapsed >= SERVER_UPDATE_INTERVAL);
        due && fs::write(&stamp, "").is_ok()
    }

    /// Installs the latest server of the given major version, and brings an
    /// installed one up to date at most once a day, which may fail without harm.
    fn install_server(&mut self, language_server_id: &LanguageServerId, major: u32) -> Result<()> {
        if self.ready_majors.contains(&major) && Self::server_exists(major) {
            return Ok(());
        }

        if !Self::server_exists(major) {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            if let Err(error) = zed::npm_install_package(&server_alias(major), &server_range(major))
            {
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
        } else if Self::server_update_due(major) {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::CheckingForUpdate,
            );
            zed::npm_install_package(&server_alias(major), &server_range(major)).ok();
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
    fn emmet_command(worktree: &zed::Worktree, project: Project) -> Result<zed::Command> {
        if project.angular
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
    fn tailwind_command(project: Project) -> Result<zed::Command> {
        let work_dir = env::current_dir().map_err(|error| error.to_string())?;
        let args = if project.tailwind {
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
    fn html_command(worktree: &zed::Worktree, project: Project) -> Result<zed::Command> {
        if project.angular
            && zed::npm_package_installed_version(HTML_PACKAGE)?.as_deref() != Some(HTML_VERSION)
        {
            zed::npm_install_package(HTML_PACKAGE, HTML_VERSION)?;
        }
        if project.angular
            && zed::npm_package_installed_version(CSS_PACKAGE)?.as_deref() != Some(CSS_VERSION)
        {
            zed::npm_install_package(CSS_PACKAGE, CSS_VERSION)?;
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

    /// Looks through the worktree again and remembers what it found.
    fn inspect_project(&mut self, worktree: &zed::Worktree) -> Result<Project> {
        Self::install_plugin()?;
        let project = run_project_script(worktree).unwrap_or_else(|| root_project(worktree));
        self.projects.insert(worktree.id(), project);
        Ok(project)
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

/// Runs `project.js` on the worktree, or gives None when the user does not
/// grant the extension to run processes.
fn run_project_script(worktree: &zed::Worktree) -> Option<Project> {
    let script = env::current_dir().ok()?.join(format!(
        "{PLUGIN_DIR}/node_modules/{PLUGIN_PACKAGE}/project.js"
    ));
    let output = zed::process::Command::new(zed::node_binary_path().ok()?)
        .arg(script.to_string_lossy())
        .arg(worktree.root_path())
        .output()
        .ok()?;
    let info: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    Some(Project {
        angular: info["angular"].as_bool()?,
        major: server_major(info["major"].as_u64().map(|major| major as u32)),
        tailwind: info["tailwind"].as_bool()?,
    })
}

/// What the root package.json and angular.json alone tell about the worktree.
fn root_project(worktree: &zed::Worktree) -> Project {
    let text = worktree.read_text_file("package.json").unwrap_or_default();
    let package: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
    let major = ["dependencies", "devDependencies"]
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
        });
    Project {
        angular: worktree.read_text_file("angular.json").is_ok()
            || text.contains("\"@angular/core\""),
        major: server_major(major),
        tailwind: text.contains("\"tailwindcss\""),
    }
}

fn server_major(major: Option<u32>) -> u32 {
    major
        .filter(|major| *major >= FIRST_SERVER_MAJOR)
        .unwrap_or(DEFAULT_SERVER_MAJOR)
}

/// The user's settings of the server, from `lsp.angular-tools.settings`.
fn user_settings(worktree: &zed::Worktree) -> serde_json::Value {
    zed::settings::LspSettings::for_worktree(SERVER_ID, worktree)
        .ok()
        .and_then(|settings| settings.settings)
        .unwrap_or_else(|| serde_json::json!({}))
}

/// Arguments of the official VS Code client, with the same defaults for its
/// `angular.*` settings. The proxy adds the probe locations, where the server
/// looks for TypeScript and @angular/language-service, and what it knows about
/// the project's Angular versions.
fn server_args(settings: &serde_json::Value) -> Vec<String> {
    let angular = &settings["angular"];
    let enabled = |value: &serde_json::Value| value.as_bool().unwrap_or(true);
    let mut args = vec!["--stdio".to_string()];
    if enabled(&angular["suggest"]["includeAutomaticOptionalChainCompletions"]) {
        args.push("--includeAutomaticOptionalChainCompletions".to_string());
    }
    if enabled(&angular["suggest"]["includeCompletionsWithSnippetText"]) {
        args.push("--includeCompletionsWithSnippetText".to_string());
    }
    args.push("--includeCompletionsForModuleExports".to_string());
    args.push(enabled(&angular["suggest"]["autoImports"]).to_string());
    if angular["forceStrictTemplates"].as_bool().unwrap_or(false) {
        args.push("--forceStrictTemplates".to_string());
    }
    if let Some(codes) = angular["suppressAngularDiagnosticCodes"]
        .as_str()
        .filter(|codes| !codes.is_empty())
    {
        args.push("--suppressAngularDiagnosticCodes".to_string());
        args.push(codes.to_string());
    }
    args
}

/// The defaults of the official client's inlay hint settings, which the server
/// would otherwise turn on, under the user's own settings.
fn server_configuration(settings: serde_json::Value) -> serde_json::Value {
    let mut configuration = serde_json::json!({
        "angular": {
            "inlayHints": {
                "bindingHints": {
                    "pipeOutputTypes": false,
                    "propertyBindingTypes": false,
                    "requiredInputIndicator": "none",
                    "twoWayBindingSignalTypes": false,
                },
                "controlFlowHints": {
                    "deferTriggerTypes": false,
                    "switchExpressionTypes": false,
                },
                "eventHints": {
                    "hostListenerArgumentTypes": false,
                    "parameterTypes": false,
                },
                "functionTypes": {
                    "arrowFunctionParameterTypes": false,
                    "arrowFunctionReturnTypes": false,
                },
                "interaction": { "interactiveInlayHints": false },
                "parameterHints": {
                    "nameHints": "all",
                    "suppressWhenArgumentMatchesName": true,
                },
                "variableTypes": {
                    "forLoopVariableTypes": false,
                    "ifAliasTypes": false,
                    "letDeclarationTypes": false,
                    "referenceVariableTypes": false,
                    "suppressWhenTypeMatchesName": false,
                },
            },
        },
    });
    merge_settings(&mut configuration, settings);
    configuration
}

fn merge_settings(target: &mut serde_json::Value, source: serde_json::Value) {
    match (target, source) {
        (serde_json::Value::Object(target), serde_json::Value::Object(source)) => {
            for (key, value) in source {
                merge_settings(target.entry(key).or_insert(serde_json::Value::Null), value);
            }
        }
        (target, source) => *target = source,
    }
}

impl zed::Extension for AngularToolsExtension {
    fn new() -> Self {
        Self {
            ready_majors: HashSet::new(),
            projects: HashMap::new(),
        }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let project = self.inspect_project(worktree)?;
        if language_server_id.as_ref() == EMMET_SERVER_ID {
            return Self::emmet_command(worktree, project);
        }
        if language_server_id.as_ref() == TAILWIND_SERVER_ID {
            return Self::tailwind_command(project);
        }
        if language_server_id.as_ref() == HTML_SERVER_ID {
            return Self::html_command(worktree, project);
        }
        let major = project.major;
        self.install_server(language_server_id, major)?;
        if project.angular {
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
        args.extend(server_args(&user_settings(worktree)));

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args,
            env: Default::default(),
        })
    }

    /// Colors plain HTML tags and attributes like in the template itself. The
    /// HTML language service marks tags as properties and attributes as values.
    fn label_for_completion(
        &self,
        language_server_id: &LanguageServerId,
        completion: zed::lsp::Completion,
    ) -> Option<zed::CodeLabel> {
        if language_server_id.as_ref() != HTML_SERVER_ID {
            return None;
        }
        let highlight = match completion.kind? {
            zed::lsp::CompletionKind::Property => "tag",
            zed::lsp::CompletionKind::Value => "attribute",
            _ => return None,
        };
        let filter_range = (0..completion.label.len()).into();
        Some(zed::CodeLabel {
            code: String::new(),
            spans: vec![zed::CodeLabelSpan::literal(
                completion.label,
                Some(highlight.to_string()),
            )],
            filter_range,
        })
    }

    /// The Angular server's settings, and for the Tailwind server those of Zed's
    /// own one, with its default for Emmet.
    fn language_server_workspace_configuration(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<serde_json::Value>> {
        if language_server_id.as_ref() == SERVER_ID {
            return Ok(Some(server_configuration(user_settings(worktree))));
        }
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
    /// cover templates and selectors, and teaches both Tailwind servers class
    /// bindings. Zed adds this to the array of the user's own settings.
    fn language_server_additional_workspace_configuration(
        &mut self,
        language_server_id: &LanguageServerId,
        target_language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<serde_json::Value>> {
        if language_server_id.as_ref() == EMMET_SERVER_ID
            || language_server_id.as_ref() == TAILWIND_SERVER_ID
            || language_server_id.as_ref() == HTML_SERVER_ID
        {
            return Ok(None);
        }
        let project = match self.projects.get(&worktree.id()) {
            Some(project) => *project,
            None => self.inspect_project(worktree)?,
        };
        if !project.angular {
            return Ok(None);
        }
        let target = target_language_server_id.as_ref();
        if target == TAILWIND_ZED_SERVER || target == TAILWIND_SERVER_ID {
            return Ok(Some(serde_json::json!({
                "tailwindCSS": { "experimental": { "classRegex": [
                    TAILWIND_CLASS_BINDING,
                    [TAILWIND_OBJECT_BINDING, TAILWIND_OBJECT_KEY],
                ] } },
            })));
        }
        if target != "vtsls" {
            return Ok(None);
        }
        let major = project.major;
        self.install_server(language_server_id, major)?;
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
