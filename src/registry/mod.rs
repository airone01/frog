pub mod error;
pub mod provider;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::fs;
use tracing::{debug, info, warn};

use self::error::RegistryError;
use crate::config::Config;
use crate::fs::FileSystem;
use crate::models::{Package, PackageReference};

#[derive(Debug, Serialize, Deserialize)]
pub struct RegistryConfig {
    providers: Vec<String>,
    default_provider: Option<String>,
}

pub struct RegistryManager {
    config: RegistryConfig,
    config_path: PathBuf,
    sgoinfre: PathBuf,
    goinfre: PathBuf,
    fs: FileSystem,
}

impl RegistryManager {
    pub async fn list_packages(&self) -> Result<Vec<Package>> {
        self.list_packages_with_provider(None).await
    }

    pub fn path_to_package_reference(&self, path: &Path) -> Result<PackageReference> {
        // Get directory name of package
        let dir_name = path
            .file_name()
            .ok_or_else(|| anyhow::anyhow!("Invalid package path"))?
            .to_str()
            .ok_or_else(|| anyhow::anyhow!("Invalid package path encoding"))?;

        // Directory format is expected to be "provider_name"
        let parts: Vec<&str> = dir_name.split('_').collect();
        if parts.len() != 2 {
            return Err(RegistryError::InvalidPackageReference(dir_name.to_string()).into());
        }

        Ok(PackageReference {
            provider: parts[0].to_string(),
            name: parts[1].to_string(),
        })
    }
    pub fn get_package_path(&self, reference: &PackageReference) -> PathBuf {
        let dir_name = format!("{}_{}", reference.provider, reference.name);
        self.sgoinfre.join(&reference.provider).join(dir_name)
    }

    pub async fn get_package_info(&self, reference: &PackageReference) -> Result<Package> {
        let package_path = self.get_package_path(reference);
        self.get_package_info_from_path(&package_path).await
    }

    async fn list_packages_with_provider(&self, provider: Option<&str>) -> Result<Vec<Package>> {
        let mut packages = Vec::new();
        let providers = match provider {
            Some(p) => vec![p.to_string()],
            _none => self.config.providers.clone(),
        };

        for provider_name in providers {
            let provider_path = self.sgoinfre.join(&provider_name);
            if !provider_path.exists() {
                continue;
            }

            let mut entries = fs::read_dir(&provider_path).await?;
            while let Some(entry) = entries.next_entry().await? {
                if !entry.file_type().await?.is_dir() {
                    continue;
                }

                match self.get_package_info_from_path(&entry.path()).await {
                    Ok(mut package) => {
                        package.provider = Some(provider_name.clone());
                        packages.push(package);
                    }
                    Err(e) => {
                        debug!(
                            "Skipping invalid package at {}: {}",
                            entry.path().display(),
                            e
                        );
                    }
                }
            }
        }

        // todo!()

        Ok(packages)
    }

    pub async fn list_providers(&self) -> Result<Vec<String>> {
        Ok(self.config.providers.clone())
    }

    pub async fn new(config: &Config, fs: &FileSystem) -> Result<Self> {
        let config_path = config.config_dir().join("registry.json");
        let registry_config = Self::load_or_create_config(&config_path, fs).await?;

        Ok(Self {
            config: registry_config,
            config_path,
            sgoinfre: PathBuf::from("/sgoinfre"),
            goinfre: PathBuf::from("/goinfre"),
            fs: fs.clone(),
        })
    }

    pub async fn initialize(&self) -> Result<()> {
        // Validate required paths exist
        for path in [&self.sgoinfre, &self.goinfre] {
            if !path.exists() {
                return Err(RegistryError::PathNotFound(path.display().to_string()).into());
            }
        }

        debug!("Registry manager initialized");
        Ok(())
    }

    pub async fn add_provider(&mut self, username: &str) -> Result<()> {
        // Check if provider already exists
        if self.config.providers.contains(&username.to_string()) {
            warn!("Provider {} already exists", username);
            return Ok(());
        }

        // Validate provider path exists
        let provider_path = self.sgoinfre.join(username);
        if !provider_path.exists() {
            return Err(RegistryError::ProviderNotFound(username.to_string()).into());
        }

        // Add provider and save config
        self.config.providers.push(username.to_string());
        self.save_config().await?;
        info!("Added provider: {}", username);
        Ok(())
    }

    pub async fn remove_provider(&mut self, username: &str) -> Result<()> {
        if let Some(pos) = self.config.providers.iter().position(|x| x == username) {
            self.config.providers.remove(pos);

            // Clear default provider if it was removed
            if self.config.default_provider.as_deref() == Some(username) {
                self.config.default_provider = None;
            }

            self.save_config().await?;
            info!("Removed provider: {}", username);
            Ok(())
        } else {
            Err(RegistryError::ProviderNotFound(username.to_string()).into())
        }
    }

    pub async fn set_default_provider(&mut self, username: &str) -> Result<()> {
        if !self.config.providers.contains(&username.to_string()) {
            return Err(RegistryError::ProviderNotFound(username.to_string()).into());
        }

        self.config.default_provider = Some(username.to_string());
        self.save_config().await?;
        info!("Set default provider: {}", username);
        Ok(())
    }

    pub fn get_default_provider(&self) -> Option<&str> {
        self.config.default_provider.as_deref()
    }

    pub async fn resolve_package_location(&self, reference: &PackageReference) -> Result<PathBuf> {
        // Validate provider exists
        if !self.config.providers.contains(&reference.provider) {
            return Err(RegistryError::ProviderNotFound(reference.provider.clone()).into());
        }

        let package_path = self
            .sgoinfre
            .join(&reference.provider)
            .join(&reference.name);

        if !package_path.exists() {
            return Err(RegistryError::PackageNotFound {
                name: reference.name.clone(),
                provider: reference.provider.clone(),
            }
            .into());
        }

        Ok(package_path)
    }

    pub async fn get_package_info_from_path(&self, package_path: &Path) -> Result<Package> {
        let config_path = package_path.join("package.json");
        if !config_path.exists() {
            let reference = self.path_to_package_reference(package_path)?;
            return Err(RegistryError::PackageNotFound {
                name: reference.name,
                provider: reference.provider,
            }
            .into());
        }

        let content = fs::read_to_string(&config_path)
            .await
            .map_err(|_| RegistryError::PackageConfigNotFound(config_path.display().to_string()))?;

        let mut package: Package = serde_json::from_str(&content)
            .map_err(|e| RegistryError::InvalidPackageConfig(e.to_string()))?;

        // Set provider from path if not already set
        if package.provider.is_none() {
            let reference = self.path_to_package_reference(package_path)?;
            package.provider = Some(reference.provider);
        }

        Ok(package)
    }

    pub async fn search_packages(&self, query: &str) -> Result<Vec<Package>> {
        let all_packages = self.list_packages().await?;
        Ok(all_packages
            .into_iter()
            .filter(|p| p.name.to_lowercase().contains(&query.to_lowercase()))
            .collect())
    }

    pub fn parse_package_reference(&self, reference: &str) -> Result<PackageReference> {
        let parts: Vec<&str> = reference.split(':').collect();

        match parts.len() {
            2 => Ok(PackageReference {
                provider: parts[0].to_string(),
                name: parts[1].to_string(),
            }),
            1 => {
                let default_provider = self
                    .get_default_provider()
                    .ok_or_else(|| RegistryError::NoDefaultProvider)?;

                Ok(PackageReference {
                    provider: default_provider.to_string(),
                    name: parts[0].to_string(),
                })
            }
            _ => Err(RegistryError::InvalidPackageReference(reference.to_string()).into()),
        }
    }

    // Private helper methods
    async fn save_config(&self) -> Result<()> {
        let content = serde_json::to_string_pretty(&self.config)?;
        fs::write(&self.config_path, content).await?;
        Ok(())
    }

    async fn load_or_create_config(config_path: &Path, fs: &FileSystem) -> Result<RegistryConfig> {
        if config_path.exists() {
            let content = fs.read_to_string(config_path).await?;
            Ok(serde_json::from_str(&content)?)
        } else {
            let config = RegistryConfig {
                providers: Vec::new(),
                default_provider: None,
            };

            if let Some(parent) = config_path.parent() {
                fs::create_dir_all(parent).await?;
            }

            let content = serde_json::to_string_pretty(&config)?;
            fs::write(config_path, content).await?;
            Ok(config)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_path_to_package_reference() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let fs = FileSystem::new();
        let config = Config::new_with_root(PathBuf::from("/test"));
        let registry = rt.block_on(RegistryManager::new(&config, &fs)).unwrap();

        let path = PathBuf::from("/sgoinfre/user42/provider_package");
        let reference = registry.path_to_package_reference(&path).unwrap();

        assert_eq!(reference.provider, "provider");
        assert_eq!(reference.name, "package");

        // Test invalid paths
        let invalid_path = PathBuf::from("/sgoinfre/user42/invalidformat");
        assert!(registry.path_to_package_reference(&invalid_path).is_err());
    }

    #[test]
    fn test_bidirectional_conversion() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let fs = FileSystem::new();
        let config = Config::new_with_root(PathBuf::from("/test"));
        let registry = rt.block_on(RegistryManager::new(&config, &fs)).unwrap();

        let reference = PackageReference {
            provider: "test42".to_string(),
            name: "mypackage".to_string(),
        };

        let path = rt
            .block_on(registry.resolve_package_location(&reference))
            .unwrap();
        let recovered = registry.path_to_package_reference(&path).unwrap();

        assert_eq!(reference.provider, recovered.provider);
        assert_eq!(reference.name, recovered.name);
    }
}
