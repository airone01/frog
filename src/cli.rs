use crate::consts::{APP_NAME, APP_VERSION};
use clap::{builder::Styles, Parser};
use clap_complete::Shell;

#[derive(Parser, Debug)]
#[command(
	name = APP_NAME,
    version = APP_VERSION,
    about,
    styles = get_styles(),
    subcommand_required = true,
	arg_required_else_help = true,
)]
pub struct Args {
    /// Install a package
    #[command(subcommand)]
    pub commands: Option<Commands>,
}

#[derive(Parser, Debug)]
#[command(subcommand_required = true, arg_required_else_help = true)]
pub enum Commands {
    #[command(alias = "i")]
    /// Install a package
    Install(Install),

    #[command(alias = "rm")]
    /// Remove a package
    Remove(Remove),

    #[command(alias = "up")]
    /// Update a package
    Update,

    #[command(alias = "ls")]
    /// List installed packages
    List,

    #[command(alias = "s")]
    /// Search for a package
    Search(Search),

    /// Display information about a package
    Info,

    /// Manage package sources (trusted students)
    Sources(Sources),

    /// Generate shell completion scripts
    Completion(Completion),
}

#[derive(Parser, Debug)]
pub struct Install {
    /// The package to install
    pub package: String,
}

#[derive(Parser, Debug)]
pub struct Remove {
    /// The package to remove
    pub package: String,
}

#[derive(Parser, Debug)]
pub struct Sources {
    #[command(subcommand)]
    pub command: Option<SourcesCommand>,
}

#[derive(Parser, Debug)]
#[command(
    about = "Source management commands",
    subcommand_required = true,
    arg_required_else_help = true
)]
pub enum SourcesCommand {
    #[command(alias = "a")]
    /// Add a package source/student
    Add(SourcesAdd),

    #[command(alias = "rm")]
    /// Remove a package source/student
    Remove(SourcesRemove),

    #[command(alias = "ls")]
    /// List package sources/students
    List,

    #[command(alias = "up")]
    /// Update package sources/students
    Update,
}

#[derive(Parser, Debug)]
pub struct SourcesAdd {
    /// The source to add
    pub source: String,
}

#[derive(Parser, Debug)]
pub struct SourcesRemove {
    /// The source to remove
    pub source: String,
}

#[derive(Parser, Debug)]
pub struct Search {
    /// The search query
    pub query: String,
}

#[derive(Parser, Debug)]
pub struct Completion {
    /// The shell to generate completions for
    pub shell: Shell,
}

pub fn get_styles() -> Styles {
    // Colors are from Rosé Pine
    // https://rosepinetheme.com/palette
    let iris_dawn = anstyle::Color::Rgb(anstyle::RgbColor(144, 122, 169));
    let foam_main = anstyle::Color::Rgb(anstyle::RgbColor(156, 207, 216));
    let love_dawn = anstyle::Color::Rgb(anstyle::RgbColor(180, 99, 122));
    let muted_dawn = anstyle::Color::Rgb(anstyle::RgbColor(152, 147, 165));
    let gold_dawn = anstyle::Color::Rgb(anstyle::RgbColor(234, 157, 52));

    Styles::styled()
        .usage(
            anstyle::Style::new()
                .bold()
                .underline()
                .fg_color(Some(iris_dawn)),
        )
        .header(
            anstyle::Style::new()
                .bold()
                .underline()
                .fg_color(Some(iris_dawn)),
        )
        .literal(anstyle::Style::new().fg_color(Some(foam_main)))
        .invalid(anstyle::Style::new().bold().fg_color(Some(love_dawn)))
        .error(anstyle::Style::new().bold().fg_color(Some(love_dawn)))
        .placeholder(anstyle::Style::new().fg_color(Some(muted_dawn)))
        .valid(anstyle::Style::new().bold().fg_color(Some(gold_dawn)))
}
