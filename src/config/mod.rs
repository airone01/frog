use anyhow::Result;
use directories::BaseDirs;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    package_root: PathBuf,
    binaries_path: PathBuf,
    temp_dir: PathBuf,
    goinfre: PathBuf,
    sgoinfre: PathBuf,
    log_level: String,
    #[serde(default)]
    registry_config: RegistryConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RegistryConfig {
    providers: Vec<String>,
    default_provider: Option<String>,
}

impl Config {
    pub async fn new() -> Result<Self> {
        let base_dirs = BaseDirs::new()
            .ok_or_else(|| anyhow::anyhow!("Failed to determine base directories"))?;

        let username = std::env::var("USER")
            .or_else(|_| std::env::var("USERNAME"))
            .map_err(|_| anyhow::anyhow!("Unable to determine username"))?;

        let config = Self {
            package_root: PathBuf::from("/sgoinfre").join(&username).join("packages"),
            binaries_path: base_dirs.home_dir().join("bin"),
            temp_dir: base_dirs.cache_dir().join("diem"),
            goinfre: PathBuf::from("/goinfre").join(&username),
            sgoinfre: PathBuf::from("/sgoinfre").join(&username),
            log_level: "info".to_string(),
            registry_config: RegistryConfig::default(),
        };

        config.ensure_directories().await?;
        Ok(config)
    }

    pub fn new_with_root(root: PathBuf) -> Self {
        Self {
            package_root: root.clone(),
            binaries_path: root.join("bin"),
            temp_dir: root.join("tmp"),
            goinfre: root.join("goinfre"),
            sgoinfre: root.join("sgoinfre"),
            log_level: "info".to_string(),
            registry_config: RegistryConfig::default(),
        }
    }

    async fn ensure_directories(&self) -> Result<()> {
        for path in [
            &self.package_root,
            &self.binaries_path,
            &self.temp_dir,
            &self.goinfre,
            &self.sgoinfre,
        ] {
            fs::create_dir_all(path).await?;
        }
        Ok(())
    }

    pub fn config_dir(&self) -> PathBuf {
        self.package_root
            .parent()
            .unwrap_or(&self.package_root)
            .to_path_buf()
    }

    pub fn registry_db_path(&self) -> PathBuf {
        self.config_dir().join("registry.db")
    }

    // Getters
    pub fn package_root(&self) -> &Path {
        &self.package_root
    }
    pub fn binaries_path(&self) -> &Path {
        &self.binaries_path
    }
    pub fn temp_dir(&self) -> &Path {
        &self.temp_dir
    }
    pub fn goinfre(&self) -> &Path {
        &self.goinfre
    }
    pub fn sgoinfre(&self) -> &Path {
        &self.sgoinfre
    }
    pub fn log_level(&self) -> &str {
        &self.log_level
    }
}
