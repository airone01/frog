mod cli;
mod config;
mod consts;
mod error;
mod package;
mod repository;

use clap::{Command, CommandFactory, Parser};
use clap_complete::{generate, Generator};
use package::get_installer;

use crate::cli::Args;

pub fn print_completions<G: Generator>(gen: G, cmd: &mut Command) {
    generate(gen, cmd, cmd.get_name().to_string(), &mut std::io::stdout());
}

#[tokio::main]
async fn main() {
    if let Err(e) = cli_matcher().await {
        eprintln!("Error: {}", e);
    }
}

async fn cli_matcher() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();

    match args.commands {
        Some(commands) => match commands {
            cli::Commands::Install(install) => {
                let mut installer = get_installer().await.unwrap();
                installer.install_package(&install.package, None).await?;
                Ok(())
            }
            cli::Commands::Remove(remove) => {
                let mut installer = get_installer().await.unwrap();
                installer.uninstall_package(&remove.package).await?;
                Ok(())
            }
            cli::Commands::Update => {
                let mut installer = get_installer().await.unwrap();
                let packages: Vec<_> = installer
                    .list_installed_packages()
                    .await
                    .into_iter()
                    .map(|(name, _)| name)
                    .collect();
                for package_name in packages {
                    installer.upgrade_package(&package_name).await?;
                }
                Ok(())
            }
            cli::Commands::List => {
                println!("Listing installed packages");
                Ok(())
            }
            cli::Commands::Search(search) => {
                println!("Searching for package: {}", search.query);
                Ok(())
            }
            cli::Commands::Info => {
                println!("Displaying information about a package");
                Ok(())
            }
            cli::Commands::Sources(sources) => {
                println!("Managing package sources: {:?}", sources);
                Ok(())
            }
            cli::Commands::Completion(comp) => {
                let mut cmd = Args::command();
                print_completions(comp.shell, &mut cmd);
                Ok(())
            }
        },
        None => {
            println!("No command provided");
            Ok(())
        }
    }
}
