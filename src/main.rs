use clap::Parser;
use colored::Colorize;
use tracing::{error, info};

mod cli;
mod config;
mod core;
mod error;
mod fs;
mod logger;
mod models;
mod package;
mod perms;
mod registry;

use crate::cli::Cli;
use crate::config::Config;
use crate::fs::FileSystem;
use crate::package::installer::PackageInstaller;
use crate::package::uninstaller::PackageUninstaller;
use crate::registry::RegistryManager;

const BANNER: &str = r#"
      _/_/
   _/      _/  _/_/    _/_/      _/_/_/
_/_/_/_/  _/_/      _/    _/  _/    _/
 _/      _/        _/    _/  _/    _/
_/      _/          _/_/      _/_/_/
                                 _/
  A simple package manager.   _/_/     "#;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logger
    logger::init_logger();

    // Print banner
    println!("{}", BANNER.bright_blue());

    // Parse command line arguments
    let cli = Cli::parse();
    // Initialize core components
    let config = Config::new().await?;
    let fs = FileSystem::new();

    // Initialize registry first
    let mut registry = RegistryManager::new(&config, &fs).await?;

    // Initialize package management component²s
    let installer = PackageInstaller::new(&config, &fs);
    let uninstaller = PackageUninstaller::new(&config, &fs);

    // Process commands
    match cli.command {
        cli::Commands::Install { package, force } => {
            let reference = registry.parse_package_reference(&package)?;
            let package_info = registry.get_package_info(&reference).await?;
            installer.install(&package_info, &reference, force).await?;
            info!("Successfully installed {}", package);
        }
        cli::Commands::Uninstall { package } => {
            let reference = registry.parse_package_reference(&package)?;
            uninstaller.uninstall(&reference).await?;
            info!("Successfully uninstalled {}", package);
        }
        cli::Commands::Update {
            package: _,
            force: _,
        } => {
            // if let Some(package_name) = package {
            //     let reference = registry.parse_package_reference(&package_name)?;
            //     let package_info = registry.get_package_info(&reference).await?;
            //     updater.update(&reference, &package_info, force).await?;
            //     info!("Successfully updated {}", package_name);
            // } else {
            //     updater.update_all(force).await?;
            // }

            info!("Update functionality is not implemented yet");
            ()
        }
        cli::Commands::List { available } => {
            if available {
                let packages = registry.list_packages().await?;
                if packages.is_empty() {
                    info!("No packages available");
                } else {
                    info!("Available packages:");
                    for pkg in packages {
                        let provider_info = pkg
                            .provider
                            .map_or(String::new(), |p| format!(" (from {})", p));
                        info!("  - {}@{}{}", pkg.name, pkg.version, provider_info);
                    }
                }
            } else {
                let installed = installer.list_installed().await?;
                if installed.is_empty() {
                    info!("No packages installed");
                } else {
                    info!("Installed packages:");
                    for pkg in installed {
                        let provider_info = pkg
                            .provider
                            .map_or(String::new(), |p| format!(" (from {})", p));
                        info!("  - {}@{}{}", pkg.name, pkg.version, provider_info);
                    }
                }
            }
        }
        cli::Commands::Search { query } => {
            let results = registry.search_packages(&query).await?;
            if results.is_empty() {
                info!("No packages found matching your query");
            } else {
                info!("Matching packages:");
                for pkg in results {
                    let provider_info = pkg
                        .provider
                        .map_or(String::new(), |p| format!(" (from {})", p));
                    info!("  - {}@{}{}", pkg.name, pkg.version, provider_info);
                    if let Some(url) = pkg.url {
                        info!("    Source: {}", url);
                    }
                }
            }
        }
        cli::Commands::Provider { command } => match command {
            cli::ProviderCommands::Add { username } => {
                registry.add_provider(&username).await?;
                info!("Successfully added provider: {}", username);
            }
            cli::ProviderCommands::Remove { username } => {
                registry.remove_provider(&username).await?;
                info!("Successfully removed provider: {}", username);
            }
            cli::ProviderCommands::Default { username } => {
                registry.set_default_provider(&username).await?;
                info!("Successfully set default provider: {}", username);
            }
            cli::ProviderCommands::List => {
                registry.list_providers().await?;
            }
        },
        cli::Commands::Sync => {
            // installer.sync().await?;
            // info!("Successfully synced packages to goinfre");

            info!("Sync functionality is not implemented yet");
            ()
        }
    }

    Ok(())
}
