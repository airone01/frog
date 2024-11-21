use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::PathBuf};
use tokio::fs as async_fs;

use crate::error::RepositoryError;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Package {
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub dependencies: Vec<String>,
    pub files: Vec<PathBuf>,
}

#[derive(Debug)]
pub struct Repository {
    path: PathBuf,
    index: HashMap<String, Vec<Package>>,
    username: String,
    is_own_repo: bool,
}

#[derive(Debug)]
pub struct RepositoryManager {
    pub sgoinfre_path: PathBuf,
    pub own_repo_path: PathBuf,
    pub username: String,
    pub repositories: HashMap<String, Repository>,
}

impl Repository {
    pub async fn new(
        path: PathBuf,
        username: String,
        is_own_repo: bool,
    ) -> Result<Self, RepositoryError> {
        if !path.exists() {
            async_fs::create_dir_all(&path).await.map_err(|e| {
                RepositoryError::InitializationError(format!(
                    "Failed to create repository directory: {}",
                    e
                ))
            })?;
        }

        // Initialize repository structure
        let repo = Repository {
            path,
            index: HashMap::new(),
            username,
            is_own_repo,
        };

        // Create necessary subdirectories
        repo.initialize_structure().await?;
        repo.load_index().await?;

        Ok(repo)
    }

    async fn initialize_structure(&self) -> Result<(), RepositoryError> {
        let dirs = ["packages", "metadata", "index"];
        for dir in dirs.iter() {
            let dir_path = self.path.join(dir);
            if !dir_path.exists() {
                async_fs::create_dir_all(&dir_path).await.map_err(|e| {
                    RepositoryError::InitializationError(format!(
                        "Failed to create {} directory: {}",
                        dir, e
                    ))
                })?;
            }
        }
        Ok(())
    }

    async fn load_index(&self) -> Result<(), RepositoryError> {
        // Implementation for loading package index
        Ok(())
    }

    pub async fn add_package(&mut self, package: Package) -> Result<(), RepositoryError> {
        if !self.is_own_repo {
            return Err(RepositoryError::PermissionDenied(
                "Cannot add packages to non-owned repository".to_string(),
            ));
        }

        // Create package directory
        let package_dir = self
            .path
            .join("packages")
            .join(&package.name)
            .join(&package.version);
        async_fs::create_dir_all(&package_dir).await?;

        // Create metadata directory
        let metadata_dir = self.path.join("metadata").join(&package.name);
        async_fs::create_dir_all(&metadata_dir).await?;

        // Save package metadata
        let metadata_path = metadata_dir.join(format!("{}.toml", package.version));

        let metadata = toml::to_string(&package).map_err(|e| {
            RepositoryError::InitializationError(format!(
                "Failed to serialize package metadata: {}",
                e
            ))
        })?;

        println!("metadata_path: {:?}", metadata_path);
        async_fs::write(metadata_path, metadata).await?;

        // Update index
        let packages = self
            .index
            .entry(package.name.clone())
            .or_insert_with(Vec::new);
        packages.push(package);

        self.save_index().await?;

        Ok(())
    }

    async fn save_index(&self) -> Result<(), RepositoryError> {
        let index_path = self.path.join("index").join("packages.toml");
        let index_contents = toml::to_string(&self.index).map_err(|e| {
            RepositoryError::InitializationError(format!("Failed to serialize index: {}", e))
        })?;

        async_fs::write(index_path, index_contents).await?;
        Ok(())
    }

    pub async fn get_package(
        &self,
        name: &str,
        version: Option<&str>,
    ) -> Result<Option<Package>, RepositoryError> {
        if let Some(packages) = self.index.get(name) {
            if let Some(version) = version {
                Ok(packages.iter().find(|p| p.version == version).cloned())
            } else {
                // Return latest version if no specific version requested
                Ok(packages.last().cloned())
            }
        } else {
            Ok(None)
        }
    }
}

impl RepositoryManager {
    pub async fn new(username: String) -> Result<Self, RepositoryError> {
        let sgoinfre_path = PathBuf::from("/sgoinfre");
        let own_repo_path = sgoinfre_path.join(&username);

        if !sgoinfre_path.exists() {
            return Err(RepositoryError::InvalidPath(
                "sgoinfre directory does not exist".to_string(),
            ));
        }

        let mut manager = RepositoryManager {
            sgoinfre_path,
            own_repo_path,
            username: username.clone(),
            repositories: HashMap::new(),
        };

        // Initialize own repository
        manager.initialize_own_repository().await?;

        Ok(manager)
    }

    async fn initialize_own_repository(&mut self) -> Result<(), RepositoryError> {
        let repo = Repository::new(self.own_repo_path.clone(), self.username.clone(), true).await?;

        self.repositories.insert(self.username.clone(), repo);
        Ok(())
    }

    pub async fn add_repository(&mut self, username: String) -> Result<(), RepositoryError> {
        if self.repositories.contains_key(&username) {
            return Err(RepositoryError::AlreadyExists(username));
        }

        let repo_path = self.sgoinfre_path.join(&username);
        if !repo_path.exists() {
            return Err(RepositoryError::NotFound(format!(
                "Repository for user {} does not exist",
                username
            )));
        }

        let repo = Repository::new(repo_path, username.clone(), false).await?;
        self.repositories.insert(username, repo);
        Ok(())
    }

    pub async fn remove_repository(&mut self, username: &str) -> Result<(), RepositoryError> {
        if username == &self.username {
            return Err(RepositoryError::PermissionDenied(
                "Cannot remove own repository".to_string(),
            ));
        }

        if self.repositories.remove(username).is_none() {
            return Err(RepositoryError::NotFound(username.to_string()));
        }

        Ok(())
    }

    pub async fn publish_package(&mut self, package: Package) -> Result<(), RepositoryError> {
        if let Some(repo) = self.repositories.get_mut(&self.username) {
            repo.add_package(package).await
        } else {
            Err(RepositoryError::NotFound(
                "Own repository not initialized".to_string(),
            ))
        }
    }

    pub async fn search_package(
        &self,
        name: &str,
        version: Option<&str>,
    ) -> Result<Vec<(String, Package)>, RepositoryError> {
        let mut results = Vec::new();

        for (username, repo) in &self.repositories {
            if let Ok(Some(package)) = repo.get_package(name, version).await {
                results.push((username.clone(), package));
            }
        }

        Ok(results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_repository_initialization() {
        let temp_dir = tempdir().unwrap();
        let username = "testuser".to_string();
        let repo = Repository::new(temp_dir.path().to_path_buf(), username.clone(), true)
            .await
            .unwrap();

        assert!(temp_dir.path().join("packages").exists());
        assert!(temp_dir.path().join("metadata").exists());
        assert!(temp_dir.path().join("index").exists());
        assert_eq!(repo.username, username);
    }

    // #[tokio::test]
    // async fn test_package_operations() {
    //     let temp_dir = tempdir().unwrap();
    //     let username = "testuser".to_string();
    //     let mut repo = Repository::new(temp_dir.path().to_path_buf(), username, true)
    //         .await
    //         .unwrap();

    //     let package = Package {
    //         name: "test-package".to_string(),
    //         version: "1.0.0".to_string(),
    //         description: Some("Test package".to_string()),
    //         dependencies: vec![],
    //         files: vec![],
    //     };

    //     // Test adding package
    //     repo.add_package(package.clone()).await.unwrap();

    //     // Test retrieving package
    //     let retrieved = repo
    //         .get_package("test-package", Some("1.0.0"))
    //         .await
    //         .unwrap();
    //     assert!(retrieved.is_some());
    //     assert_eq!(retrieved.unwrap().name, "test-package");
    // }
}
