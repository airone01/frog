use std::env::temp_dir;
use std::path::PathBuf;

use dirs::executable_dir;

use crate::error::InstallationError;
use crate::package::install::PackageInstaller;
use crate::repository::RepositoryManager;

mod install;

pub async fn get_installer() -> Result<PackageInstaller, InstallationError> {
    let repo_manager = RepositoryManager::new(whoami::username().to_string()).await?;
    PackageInstaller::new(
        repo_manager,
        PathBuf::from(executable_dir().expect("Failed to get executable directory")),
        PathBuf::from(temp_dir().join("package-manager")),
    )
    .await
}
