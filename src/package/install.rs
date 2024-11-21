use semver::Version;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};
use tokio::fs;

use crate::{
    error::InstallationError,
    repository::{Package, RepositoryManager},
};

#[derive(Debug, Serialize, Deserialize)]
pub struct InstallationMetadata {
    pub installed_version: String,
    pub installed_from: String,
    pub install_date: chrono::DateTime<chrono::Utc>,
    pub files: Vec<PathBuf>,
}

#[derive(Debug)]
pub struct PackageInstaller {
    repo_manager: RepositoryManager,
    bin_path: PathBuf,
    temp_path: PathBuf,
    installed_packages: HashMap<String, InstallationMetadata>,
}

impl PackageInstaller {
    pub async fn new(
        repo_manager: RepositoryManager,
        bin_path: PathBuf,
        temp_path: PathBuf,
    ) -> Result<Self, InstallationError> {
        // Ensure directories exist
        fs::create_dir_all(&bin_path).await?;
        fs::create_dir_all(&temp_path).await?;

        let mut installer = PackageInstaller {
            repo_manager,
            bin_path,
            temp_path,
            installed_packages: HashMap::new(),
        };

        installer.load_installation_metadata().await?;
        Ok(installer)
    }

    async fn load_installation_metadata(&mut self) -> Result<(), InstallationError> {
        let metadata_path = self.temp_path.join("installed_packages.toml");
        if metadata_path.exists() {
            let content = fs::read_to_string(&metadata_path).await?;
            self.installed_packages = toml::from_str(&content).map_err(|e| {
                InstallationError::InstallationFailed(format!(
                    "Failed to parse installation metadata: {}",
                    e
                ))
            })?;
        }
        Ok(())
    }

    async fn save_installation_metadata(&self) -> Result<(), InstallationError> {
        let metadata_path = self.temp_path.join("installed_packages.toml");
        let content = toml::to_string(&self.installed_packages).map_err(|e| {
            InstallationError::InstallationFailed(format!(
                "Failed to serialize installation metadata: {}",
                e
            ))
        })?;
        fs::write(metadata_path, content).await?;
        Ok(())
    }

    pub async fn install_package(
        &mut self,
        name: &str,
        version_req: Option<&str>,
    ) -> Result<(), InstallationError> {
        self.install_package_inner(name, version_req).await
    }

    async fn install_package_inner(
        &mut self,
        name: &str,
        version_req: Option<&str>,
    ) -> Result<(), InstallationError> {
        println!("🔍 Resolving package {}...", name);

        // Find the package across repositories
        let results = self.repo_manager.search_package(name, version_req).await?;
        let (username, package) = results.first().ok_or_else(|| {
            InstallationError::PackageNotFound(format!(
                "{}@{}",
                name,
                version_req.unwrap_or("latest")
            ))
        })?;

        println!(
            "📦 Found package {} v{} in {}'s repository",
            name, package.version, username
        );

        // Resolve dependencies
        let deps = self.resolve_dependencies(&package).await?;

        println!("📋 Installing dependencies...");

        // Install dependencies first
        for dep in deps {
            if !self.is_package_installed(&dep.name) {
                Box::pin(self.install_package_inner(&dep.name, Some(&dep.version))).await?;
            }
        }

        // Create temporary directory for package installation
        let temp_install_dir = self.temp_path.join(format!("{}-{}", name, package.version));
        fs::create_dir_all(&temp_install_dir).await?;

        println!("📥 Downloading package files...");

        // Download package files
        self.download_package_files(username, package, &temp_install_dir)
            .await?;

        println!("🔧 Installing binaries...");

        // Install binaries
        let installed_files = self.install_binaries(package, &temp_install_dir).await?;

        // Update installation metadata
        let metadata = InstallationMetadata {
            installed_version: package.version.clone(),
            installed_from: username.clone(),
            install_date: chrono::Utc::now(),
            files: installed_files,
        };
        self.installed_packages.insert(name.to_string(), metadata);
        self.save_installation_metadata().await?;

        // Cleanup
        fs::remove_dir_all(temp_install_dir).await?;

        println!("✨ Successfully installed {} v{}", name, package.version);

        Ok(())
    }

    async fn resolve_dependencies(
        &self,
        package: &Package,
    ) -> Result<Vec<Package>, InstallationError> {
        let mut resolved = HashSet::new();
        let mut to_resolve = Vec::new();
        to_resolve.extend(package.dependencies.clone());

        while let Some(dep) = to_resolve.pop() {
            if resolved.contains(&dep) {
                continue;
            }

            let results = self.repo_manager.search_package(&dep, None).await?;
            let (_, dep_package) = results.first().ok_or_else(|| {
                InstallationError::DependencyResolutionFailed(format!(
                    "Dependency not found: {}",
                    dep
                ))
            })?;

            resolved.insert(dep);
            to_resolve.extend(dep_package.dependencies.clone());
        }

        let deps: Vec<_> = resolved.into_iter().collect();
        let mut result = Vec::new();

        for name in deps {
            if let Ok(results) = self.repo_manager.search_package(&name, None).await {
                if let Some((_, package)) = results.first().cloned() {
                    result.push(package);
                }
            }
        }

        Ok(result)
    }

    async fn download_package_files(
        &self,
        username: &str,
        package: &Package,
        temp_dir: &Path,
    ) -> Result<(), InstallationError> {
        let repo_path = self.repo_manager.sgoinfre_path.join(username);

        // Download files in parallel
        let mut tasks = Vec::new();
        for file in &package.files {
            let src = repo_path
                .join("packages")
                .join(&package.name)
                .join(&package.version)
                .join(file);
            let dst = temp_dir.join(file);

            // Create parent directories
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent).await?;
            }

            tasks.push(tokio::spawn(async move { fs::copy(src, dst).await }));
        }

        // Wait for all downloads to complete
        for task in tasks {
            task.await.map_err(|e| {
                InstallationError::InstallationFailed(format!("Download task failed: {}", e))
            })??;
        }

        Ok(())
    }

    async fn install_binaries(
        &self,
        package: &Package,
        temp_dir: &Path,
    ) -> Result<Vec<PathBuf>, InstallationError> {
        let mut installed_files = Vec::new();

        for file in &package.files {
            let src = temp_dir.join(file);
            let dst = self.bin_path.join(file.file_name().ok_or_else(|| {
                InstallationError::InstallationFailed("Invalid file name".to_string())
            })?);

            // Copy file to bin directory
            fs::copy(&src, &dst).await?;

            // Make binary executable
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = fs::metadata(&dst).await?.permissions();
                perms.set_mode(0o755);
                fs::set_permissions(&dst, perms).await?;
            }

            installed_files.push(dst);
        }

        Ok(installed_files)
    }

    pub async fn uninstall_package(&mut self, name: &str) -> Result<(), InstallationError> {
        let metadata = self
            .installed_packages
            .get(name)
            .ok_or_else(|| InstallationError::PackageNotFound(name.to_string()))?;

        println!(
            "🗑️  Uninstalling {} v{}...",
            name, metadata.installed_version
        );

        // Remove installed files
        for file in &metadata.files {
            if file.exists() {
                fs::remove_file(file).await?;
            }
        }

        // Update metadata
        self.installed_packages.remove(name);
        self.save_installation_metadata().await?;

        println!("✨ Successfully uninstalled {}", name);

        Ok(())
    }

    pub fn is_package_installed(&self, name: &str) -> bool {
        self.installed_packages.contains_key(name)
    }

    pub fn get_installed_version(&self, name: &str) -> Option<&str> {
        self.installed_packages
            .get(name)
            .map(|m| m.installed_version.as_str())
    }

    pub async fn list_installed_packages(&self) -> Vec<(String, &InstallationMetadata)> {
        self.installed_packages
            .iter()
            .map(|(name, metadata)| (name.clone(), metadata))
            .collect()
    }

    pub async fn upgrade_package(&mut self, name: &str) -> Result<(), InstallationError> {
        let current_version = self
            .get_installed_version(name)
            .ok_or_else(|| InstallationError::PackageNotFound(name.to_string()))?;

        // Find latest version
        let results = self.repo_manager.search_package(name, None).await?;
        let (_username, package) = results
            .first()
            .ok_or_else(|| InstallationError::PackageNotFound(name.to_string()))?;

        // Compare versions
        let current_version = Version::parse(current_version).map_err(|_| {
            InstallationError::InstallationFailed("Invalid current version".to_string())
        })?;
        let latest_version = Version::parse(&package.version).map_err(|_| {
            InstallationError::InstallationFailed("Invalid latest version".to_string())
        })?;

        if latest_version > current_version {
            println!(
                "📦 Upgrading {} from v{} to v{}...",
                name, current_version, latest_version
            );
            self.install_package(name, Some(&package.version)).await?;
        } else {
            println!(
                "✨ {} is already at the latest version (v{})",
                name, current_version
            );
        }

        Ok(())
    }
}
