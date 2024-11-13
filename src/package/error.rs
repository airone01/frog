use thiserror::Error;

#[derive(Error, Debug)]
pub enum PackageError {
    #[error("Package {0} not found")]
    NotFound(String),

    #[error("Installation for package {0} is already in progress")]
    InstallLocked(String),

    #[error("Package URL is required for {0}")]
    MissingUrl(String),

    #[error("Failed to download package {0}: {1}")]
    DownloadFailed(String, String),

    #[error("Checksum verification failed. Expected: {expected}, Got: {actual}")]
    ChecksumMismatch { expected: String, actual: String },

    #[error("Failed to extract package")]
    ExtractionFailed,

    #[error("Install script failed: {0}")]
    InstallScriptFailed(String),

    #[error("Binary {0} already exists")]
    BinaryExists(String),

    #[error("Failed to validate package signature")]
    SignatureValidationFailed,

    #[error("System error: {0}")]
    SystemError(#[from] std::io::Error),

    #[error("Failed to create backup: {0}")]
    BackupFailed(String),

    #[error("Failed to restore from backup: {0}")]
    RestoreFailed(String),

    #[error("Failed to remove package files: {0}")]
    RemovalFailed(String),

    #[error("Failed to update registry: {0}")]
    RegistryUpdateFailed(String),

    #[error("Failed to clean up goinfre: {0}")]
    GoinfreCleanupFailed(String),
}
