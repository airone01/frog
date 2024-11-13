use clap::Parser;

#[derive(Parser)]
#[command(name = "diem")]
#[command(about = None, long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(clap::Subcommand)]
pub enum Commands {
    /// Install a package
    Install {
        /// Package to install (format: [provider:]package)
        package: String,
        /// Force installation even if binaries exist
        #[clap(short, long)]
        force: bool,
    },

    /// Uninstall a package
    Uninstall {
        /// Package to uninstall
        package: String,
    },

    /// Update packages
    Update {
        /// Specific package to update
        package: Option<String>,
        /// Force update even if binaries exist
        #[clap(short, long)]
        force: bool,
    },

    /// List packages
    List {
        /// List available packages instead of installed ones
        #[clap(short, long)]
        available: bool,
    },

    /// Search for packages
    Search {
        /// Search query
        query: String,
    },

    /// Manage providers
    Provider {
        #[command(subcommand)]
        command: ProviderCommands,
    },

    /// Sync packages to goinfre
    Sync,
}

#[derive(clap::Subcommand)]
pub enum ProviderCommands {
    /// Add a provider
    Add {
        /// Provider username
        username: String,
    },

    /// Remove a provider
    Remove {
        /// Provider username
        username: String,
    },

    /// Set default provider
    Default {
        /// Provider username
        username: String,
    },

    /// List configured providers
    List,
}
