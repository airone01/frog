use thiserror::Error;

#[derive(Error, Debug)]
pub enum DiemError {
    #[error("Package not found: {0}")]
    PackageNotFound(String),

    #[error("Installation failed: {0}")]
    InstallFailed(String),

    #[error("Invalid package reference: {0}")]
    InvalidReference(String),

    #[error("Configuration error: {0}")]
    ConfigError(String),

    #[error("Registry error: {0}")]
    RegistryError(String),

    #[error("File system error: {0}")]
    FileSystemError(String),

    #[error("I/O error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Network error: {0}")]
    NetworkError(#[from] reqwest::Error),
}
