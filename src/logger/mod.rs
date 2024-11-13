mod config;
mod formatter;

use std::sync::Once;
use tracing_subscriber::{
    fmt::{self},
    EnvFilter,
};

static INIT: Once = Once::new();

pub fn init_logger() {
    INIT.call_once(|| {
        let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

        let format = fmt::format()
            .with_level(true)
            .with_target(false)
            .with_thread_ids(false)
            .with_thread_names(false)
            .with_file(false)
            .with_line_number(false);
        // .with_formatter(formatter::DiemFormatter::new());

        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .event_format(format)
            .with_writer(std::io::stdout)
            .init();
    });
}
