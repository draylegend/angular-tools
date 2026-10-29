use std::{env, fs};
use zed_extension_api::{self as zed, LanguageServerId, Result};

const SERVER_PACKAGE: &str = "@angular/language-server";
// The server pins its own @angular/language-service and TypeScript, so one
// version here fixes every package that gets installed.
const SERVER_VERSION: &str = "22.2.3";
const SERVER_PATH: &str = "node_modules/@angular/language-server/index.js";

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
        let work_dir = env::current_dir().map_err(|error| error.to_string())?;
        let probe_locations = format!("{},{}", work_dir.to_string_lossy(), worktree.root_path());
        let mut args = vec![work_dir.join(SERVER_PATH).to_string_lossy().into_owned()];
        args.extend(server_args(&probe_locations));

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args,
            env: Default::default(),
        })
    }
}

zed::register_extension!(AngularToolsExtension);
