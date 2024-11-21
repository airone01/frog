use thiserror::Error;

#[derive(Error, Debug)]
pub enum ConfigError {
    #[error("Failed to read config file: {0}")]
    ReadError(#[from] std::io::Error),
    #[error("Failed to parse TOML: {0}")]
    ParseError(#[from] toml::de::Error),
    #[error("Failed to serialize TOML: {0}")]
    SerializeError(#[from] toml::ser::Error),
    #[error("Invalid configuration: {0}")]
    ValidationError(String),
}

#[derive(Error, Debug)]
pub enum RepositoryError {
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Repository already exists: {0}")]
    AlreadyExists(String),
    #[error("Repository not found: {0}")]
    NotFound(String),
    #[error("Invalid repository path: {0}")]
    InvalidPath(String),
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
    #[error("Repository initialization failed: {0}")]
    InitializationError(String),
}

#[derive(Error, Debug)]
pub enum PackageError {
    #[error("Failed to read package file: {0}")]
    ReadError(#[from] std::io::Error),
    #[error("Failed to parse TOML: {0}")]
    ParseError(#[from] toml::de::Error),
    #[error("Failed to serialize TOML: {0}")]
    SerializeError(#[from] toml::ser::Error),
    #[error("Invalid package: {0}")]
    ValidationError(String),
}

#[derive(Debug, Error)]
pub enum InstallationError {
    #[error("Package not found: {0}")]
    PackageNotFound(String),
    #[error("Version not found: {0} {1}")]
    VersionNotFound(String, String),
    #[error("Dependency resolution failed: {0}")]
    DependencyResolutionFailed(String),
    #[error("Installation failed: {0}")]
    InstallationFailed(String),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Repository error: {0}")]
    RepositoryError(#[from] RepositoryError),
}
