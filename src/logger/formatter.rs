use colored::Colorize;
use std::fmt;
use tracing::Level;
use tracing::{Event, Subscriber};
use tracing_subscriber::fmt::format::{FormatEvent, FormatFields, Writer};
use tracing_subscriber::fmt::FmtContext;
use tracing_subscriber::registry::LookupSpan;

pub struct DiemFormatter;

impl DiemFormatter {
    pub fn new() -> Self {
        Self
    }
}

impl<S, N> FormatEvent<S, N> for DiemFormatter
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> fmt::Result {
        let metadata = event.metadata();

        // Format level with color
        let level = match *metadata.level() {
            Level::ERROR => "ERROR".red().to_string(),
            Level::WARN => "WARN".yellow().to_string(),
            Level::INFO => "INFO".green().to_string(),
            Level::DEBUG => "DEBUG".blue().to_string(),
            Level::TRACE => "TRACE".magenta().to_string(),
        };

        // Write level and fields
        write!(writer, "{:>5} ", level)?;
        ctx.field_format().format_fields(writer, event)
    }
}
