mod cli;
mod consts;

use clap::{Command, CommandFactory, Parser};
use clap_complete::{generate, Generator};

use crate::cli::Args;

pub fn print_completions<G: Generator>(gen: G, cmd: &mut Command) {
    generate(gen, cmd, cmd.get_name().to_string(), &mut std::io::stdout());
}

fn main() {
    let args = Args::parse();

    match args.commands {
        Some(commands) => match commands {
            cli::Commands::Install(install) => {
                println!("Installing package: {}", install.package);
            }
            cli::Commands::Remove(remove) => {
                println!("Removing package: {}", remove.package);
            }
            cli::Commands::Update => {
                println!("Updating packages");
            }
            cli::Commands::List => {
                println!("Listing installed packages");
            }
            cli::Commands::Search(search) => {
                println!("Searching for package: {}", search.query);
            }
            cli::Commands::Info => {
                println!("Displaying information about a package");
            }
            cli::Commands::Sources(sources) => {
                println!("Managing package sources: {:?}", sources);
            }
            cli::Commands::Completion(comp) => {
                let mut cmd = Args::command();
                print_completions(comp.shell, &mut cmd);
            }
        },
        None => {
            println!("No command provided");
        }
    }
}
