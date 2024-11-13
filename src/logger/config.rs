use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggerConfig {
    pub level: LogLevel,
    pub show_timestamps: bool,
    pub show_target: bool,
    pub file_logging: Option<FileLoggingConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileLoggingConfig {
    pub enabled: bool,
    pub path: String,
    pub max_size: usize,
    pub max_files: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

impl Default for LoggerConfig {
    fn default() -> Self {
        Self {
            level: LogLevel::Info,
            show_timestamps: true,
            show_target: false,
            file_logging: None,
        }
    }
}
