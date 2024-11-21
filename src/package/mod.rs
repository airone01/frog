use std::env::temp_dir;
use std::path::PathBuf;

use dirs::executable_dir;

use crate::error::InstallationError;
use crate::package::install::PackageInstaller;
use crate::repository::RepositoryManager;

mod install;
mod publish;

pub use publish::PackagePublisher;

pub async fn get_installer() -> Result<PackageInstaller, InstallationError> {
    let repo_manager = RepositoryManager::new(whoami::username().to_string()).await?;
    PackageInstaller::new(
        repo_manager,
        PathBuf::from(executable_dir().expect("Failed to get executable directory")),
        PathBuf::from(temp_dir().join("package-manager")),
    )
    .await
}

pub async fn publish_package(manifest_path: PathBuf) -> Result<(), InstallationError> {
    let mut repo_manager = RepositoryManager::new(whoami::username().to_string()).await?;
    let publisher = PackagePublisher::new(manifest_path).await.map_err(|e| {
        InstallationError::InstallationFailed(format!("Failed to create publisher: {}", e))
    })?;

    publisher.publish(&mut repo_manager).await.map_err(|e| {
        InstallationError::InstallationFailed(format!("Failed to publish package: {}", e))
    })
}
