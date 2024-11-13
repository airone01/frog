use anyhow::Result;
use std::path::PathBuf;
use tokio::fs;
use tracing::{debug, info, warn};

use crate::config::Config;
use crate::error;
use crate::fs::FileSystem;
use crate::models::{Package, PackageReference};
use crate::package::error::PackageError;

pub struct PackageUninstaller {
    config: Config,
    fs: FileSystem,
}

impl PackageUninstaller {
    pub fn new(config: &Config, fs: &FileSystem) -> Self {
        Self {
            config: config.clone(),
            fs: fs.clone(),
        }
    }

    pub async fn uninstall(&self, reference: &PackageReference) -> Result<()> {
        info!("Uninstalling package {}", reference.name);

        // Get package info before removal
        let package = self.get_package_info(reference).await?;

        // Create a backup before uninstallation
        let backup = self.create_backup(reference, &package).await?;

        match self.perform_uninstall(&package, reference).await {
            Ok(_) => {
                // Clean up backup on success
                if let Err(e) = self.cleanup_backup(backup).await {
                    warn!("Failed to clean up backup: {}", e);
                }
                info!("Successfully uninstalled {}", reference.name);
                Ok(())
            }
            Err(e) => {
                // Attempt to restore from backup on failure
                warn!("Uninstallation failed, attempting to restore from backup");
                if let Err(restore_err) = self.restore_from_backup(backup, reference).await {
                    error!("Failed to restore from backup: {}", restore_err);
                    return Err(restore_err);
                }
                Err(e)
            }
        }
    }

    async fn perform_uninstall(
        &self,
        package: &Package,
        reference: &PackageReference,
    ) -> Result<()> {
        // Remove symlinks first
        self.remove_symlinks(&package.binaries).await?;

        // Remove package files
        self.remove_package_files(reference).await?;

        // Clean up goinfre directory if it exists
        self.cleanup_goinfre(reference).await?;

        // Remove package from registry
        self.remove_from_registry(reference).await?;

        Ok(())
    }

    async fn remove_symlinks(&self, binaries: &[String]) -> Result<()> {
        for binary in binaries {
            let symlink_path = self.config.binaries_path().join(binary);

            if symlink_path.exists() {
                match fs::remove_file(&symlink_path).await {
                    Ok(_) => {
                        debug!("Removed symlink: {}", symlink_path.display());
                    }
                    Err(e) => {
                        warn!("Failed to remove symlink {}: {}", symlink_path.display(), e);
                        // Continue with other symlinks even if one fails
                    }
                }
            }
        }
        Ok(())
    }

    async fn remove_package_files(&self, reference: &PackageReference) -> Result<()> {
        let package_dir = self.get_package_directory(reference);

        if package_dir.exists() {
            fs::remove_dir_all(&package_dir).await?;
            debug!("Removed package directory: {}", package_dir.display());
        }

        Ok(())
    }

    async fn cleanup_goinfre(&self, reference: &PackageReference) -> Result<()> {
        let goinfre_dir = self.config.goinfre().join(&reference.name);

        if goinfre_dir.exists() {
            fs::remove_dir_all(&goinfre_dir).await?;
            debug!("Removed goinfre directory: {}", goinfre_dir.display());
        }

        Ok(())
    }

    async fn remove_from_registry(&self, reference: &PackageReference) -> Result<()> {
        let registry_path = self.config.registry_db_path();
        if !registry_path.exists() {
            return Ok(());
        }

        let content = fs::read_to_string(&registry_path).await?;
        let mut registry: serde_json::Value = serde_json::from_str(&content)?;

        if let serde_json::Value::Object(ref mut map) = registry {
            let key = format!("{}:{}", reference.provider, reference.name);
            map.remove(&key);
            fs::write(registry_path, serde_json::to_string_pretty(&registry)?).await?;
        }

        Ok(())
    }

    async fn get_package_info(&self, reference: &PackageReference) -> Result<Package> {
        let package_dir = self.get_package_directory(reference);
        let package_json = package_dir.join("package.json");

        if !package_json.exists() {
            return Err(PackageError::NotFound(reference.name.clone()).into());
        }

        let content = fs::read_to_string(package_json).await?;
        let package: Package = serde_json::from_str(&content)?;
        Ok(package)
    }

    async fn create_backup(
        &self,
        reference: &PackageReference,
        package: &Package,
    ) -> Result<PathBuf> {
        let package_dir = self.get_package_directory(reference);
        let backup_dir = self.get_backup_directory(reference, package);

        if package_dir.exists() {
            let options = fs_extra::dir::CopyOptions::new()
                .overwrite(true)
                .content_only(true);

            fs_extra::dir::copy(&package_dir, &backup_dir, &options)?;
            debug!("Created backup at {}", backup_dir.display());
        }

        Ok(backup_dir)
    }

    async fn restore_from_backup(
        &self,
        backup_dir: PathBuf,
        reference: &PackageReference,
    ) -> Result<()> {
        let package_dir = self.get_package_directory(reference);

        if backup_dir.exists() {
            // Remove failed installation if it exists
            if package_dir.exists() {
                fs::remove_dir_all(&package_dir).await?;
            }

            // Restore from backup
            fs::create_dir_all(&package_dir).await?;
            let options = fs_extra::dir::CopyOptions::new()
                .overwrite(true)
                .content_only(true);

            fs_extra::dir::copy(&backup_dir, &package_dir, &options)?;
            debug!("Restored from backup: {}", backup_dir.display());
        }

        Ok(())
    }

    async fn cleanup_backup(&self, backup_dir: PathBuf) -> Result<()> {
        if backup_dir.exists() {
            fs::remove_dir_all(backup_dir).await?;
        }
        Ok(())
    }

    fn get_package_directory(&self, reference: &PackageReference) -> PathBuf {
        let dir_name = format!("{}_{}", reference.provider, reference.name);
        self.config.package_root().join(dir_name)
    }

    fn get_backup_directory(&self, reference: &PackageReference, package: &Package) -> PathBuf {
        let base_dir = self.get_package_directory(reference);
        base_dir.with_extension(format!("backup_{}", package.version))
    }
}
