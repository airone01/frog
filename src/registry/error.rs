use thiserror::Error;

#[derive(Error, Debug)]
pub enum RegistryError {
    #[error("Provider not found: {0}")]
    ProviderNotFound(String),

    #[error("Package {name} not found in provider {provider}")]
    PackageNotFound { name: String, provider: String },

    #[error("Package config not found: {0}")]
    PackageConfigNotFound(String),

    #[error("Invalid package config: {0}")]
    InvalidPackageConfig(String),

    #[error("Invalid package reference: {0}")]
    InvalidPackageReference(String),

    #[error("No default provider configured")]
    NoDefaultProvider,

    #[error("Required path not found: {0}")]
    PathNotFound(String),

    #[error("Registry operation failed: {0}")]
    OperationFailed(String),
}
