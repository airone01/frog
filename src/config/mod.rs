use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use crate::{consts::CONFIG_VERSION, error::ConfigError};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Repository {
    pub url: String,
    pub enabled: bool,
    #[serde(default = "default_priority")]
    pub priority: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Config {
    pub config_version: String,
    pub temp_path: PathBuf,
    pub bin_path: PathBuf,
    pub sgoinfre_username: Option<String>,
    pub repositories: HashMap<String, Repository>,
}

impl Config {
    /// Creates a new default configuration
    pub fn default() -> Self {
        Config {
            config_version: String::from("1.0"),
            temp_path: default_temp_path(),
            bin_path: default_bin_path(),
            sgoinfre_username: None,
            repositories: default_repositories(),
        }
    }

    /// Loads configuration from a file
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self, ConfigError> {
        let content = fs::read_to_string(path)?;
        let config: Config = toml::from_str(&content)?;
        config.validate()?;
        Ok(config)
    }

    /// Saves configuration to a file
    pub fn save<P: AsRef<Path>>(&self, path: P) -> Result<(), ConfigError> {
        self.validate()?;
        let toml_string = toml::to_string_pretty(self)?;
        fs::write(path, toml_string)?;
        Ok(())
    }

    /// Validates the configuration
    fn validate(&self) -> Result<(), ConfigError> {
        // Validate temp_path
        if !self.temp_path.is_absolute() {
            return Err(ConfigError::ValidationError(
                "temp_path must be absolute".to_string(),
            ));
        }

        // Validate bin_path
        if !self.bin_path.is_absolute() {
            return Err(ConfigError::ValidationError(
                "bin_path must be absolute".to_string(),
            ));
        }

        // Validate repositories
        if self.repositories.is_empty() {
            return Err(ConfigError::ValidationError(
                "At least one repository must be configured".to_string(),
            ));
        }

        // Validate repository URLs
        for (name, repo) in &self.repositories {
            if repo.url.is_empty() {
                return Err(ConfigError::ValidationError(format!(
                    "Repository '{}' has an empty URL",
                    name
                )));
            }
            // Basic URL validation - could be more sophisticated
            if !repo.url.starts_with("http://") && !repo.url.starts_with("https://") {
                return Err(ConfigError::ValidationError(format!(
                    "Repository '{}' URL must start with http:// or https://",
                    name
                )));
            }
        }

        Ok(())
    }

    /// Adds a new repository
    pub fn add_repository(&mut self, name: String, url: String) -> Result<(), ConfigError> {
        if self.repositories.contains_key(&name) {
            return Err(ConfigError::ValidationError(format!(
                "Repository '{}' already exists",
                name
            )));
        }

        let repo = Repository {
            url,
            enabled: true,
            priority: default_priority(),
        };

        self.repositories.insert(name, repo);
        Ok(())
    }

    /// Removes a repository
    pub fn remove_repository(&mut self, name: &str) -> Result<(), ConfigError> {
        if !self.repositories.contains_key(name) {
            return Err(ConfigError::ValidationError(format!(
                "Repository '{}' does not exist",
                name
            )));
        }

        self.repositories.remove(name);

        if self.repositories.is_empty() {
            return Err(ConfigError::ValidationError(
                "Cannot remove last repository".to_string(),
            ));
        }

        Ok(())
    }
}

fn default_priority() -> u32 {
    100
}

fn default_temp_path() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("rust-package-manager")
}

fn default_bin_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/usr/local"))
        .join(".local/bin")
}

fn default_repositories() -> HashMap<String, Repository> {
    let mut repos = HashMap::new();
    repos.insert(
        "default".to_string(),
        Repository {
            url: "https://default-repo.example.com".to_string(),
            enabled: true,
            priority: default_priority(),
        },
    );
    repos
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_config_validation() {
        let mut config = Config::default();
        assert!(config.validate().is_ok());

        // Test invalid temp_path
        config.temp_path = PathBuf::from("relative/path");
        assert!(config.validate().is_err());

        // Reset and test invalid bin_path
        config = Config::default();
        config.bin_path = PathBuf::from("relative/path");
        assert!(config.validate().is_err());

        // Test empty repositories
        config = Config::default();
        config.repositories.clear();
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_repository_management() {
        let mut config = Config::default();

        // Test adding repository
        assert!(config
            .add_repository(
                "test".to_string(),
                "https://test-repo.example.com".to_string()
            )
            .is_ok());

        // Test adding duplicate repository
        assert!(config
            .add_repository(
                "test".to_string(),
                "https://another-repo.example.com".to_string()
            )
            .is_err());

        // Test removing repository
        assert!(config.remove_repository("test").is_ok());

        // Test removing non-existent repository
        assert!(config.remove_repository("nonexistent").is_err());

        // Test removing last repository
        assert!(config.remove_repository("default").is_err());
    }

    #[test]
    fn test_config_file_operations() -> Result<(), ConfigError> {
        let temp_dir = tempdir().unwrap();
        let config_path = temp_dir.path().join("config.toml");

        // Create and save config
        let config = Config::default();
        config.save(&config_path)?;

        // Load and verify config
        let loaded_config = Config::load(&config_path)?;
        assert_eq!(loaded_config.config_version, config.config_version);
        assert_eq!(loaded_config.repositories.len(), config.repositories.len());

        Ok(())
    }
}
