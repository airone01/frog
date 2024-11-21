use crate::error::PackageError;
use crate::repository::Package;
use semver::Version;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PackageManifest {
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub authors: Vec<String>,
    pub license: Option<String>,
    pub repository: Option<String>,
    pub dependencies: Vec<String>,
    pub files: Vec<PathBuf>,
}

pub struct PackagePublisher {
    manifest: PackageManifest,
    package_dir: PathBuf,
}

impl PackagePublisher {
    pub async fn new(manifest_path: PathBuf) -> Result<Self, PackageError> {
        // Read and parse manifest file
        let content = fs::read_to_string(&manifest_path)
            .await
            .map_err(|e| PackageError::ReadError(e))?;

        let manifest: PackageManifest =
            toml::from_str(&content).map_err(|e| PackageError::ParseError(e))?;

        // Validate manifest
        Self::validate_manifest(&manifest)?;

        Ok(PackagePublisher {
            manifest,
            package_dir: manifest_path
                .parent()
                .unwrap_or(Path::new("."))
                .to_path_buf(),
        })
    }

    fn validate_manifest(manifest: &PackageManifest) -> Result<(), PackageError> {
        // Validate package name
        if manifest.name.is_empty()
            || !manifest
                .name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(PackageError::ValidationError(
                "Invalid package name. Must be non-empty and contain only ASCII alphanumeric characters, '-', or '_'".to_string()
            ));
        }

        // Validate version
        if Version::parse(&manifest.version).is_err() {
            return Err(PackageError::ValidationError(
                "Invalid version format. Must be a valid semantic version".to_string(),
            ));
        }

        // Validate files
        for file in &manifest.files {
            if !file.is_relative() {
                return Err(PackageError::ValidationError(
                    "File paths must be relative to package directory".to_string(),
                ));
            }
        }

        Ok(())
    }

    pub async fn publish(
        &self,
        repo_manager: &mut crate::repository::RepositoryManager,
    ) -> Result<(), PackageError> {
        println!("🔍 Validating package...");

        // Create package from manifest
        let package = Package {
            name: self.manifest.name.clone(),
            version: self.manifest.version.clone(),
            description: self.manifest.description.clone(),
            dependencies: self.manifest.dependencies.clone(),
            files: self.manifest.files.clone(),
        };

        // Verify all files exist
        for file in &package.files {
            let file_path = self.package_dir.join(file);
            if !file_path.exists() {
                return Err(PackageError::ValidationError(format!(
                    "File not found: {}",
                    file.display()
                )));
            }
        }

        println!(
            "📦 Publishing package {} v{}...",
            package.name, package.version
        );

        // Publish to repository
        repo_manager.publish_package(package).await.map_err(|e| {
            PackageError::ValidationError(format!("Failed to publish package: {}", e))
        })?;

        println!(
            "✨ Successfully published {} v{}",
            self.manifest.name, self.manifest.version
        );

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_manifest_validation() {
        let valid_manifest = PackageManifest {
            name: "test-package".to_string(),
            version: "1.0.0".to_string(),
            description: Some("Test package".to_string()),
            authors: vec!["Test Author".to_string()],
            license: Some("MIT".to_string()),
            repository: None,
            dependencies: vec![],
            files: vec![PathBuf::from("test.txt")],
        };

        assert!(PackagePublisher::validate_manifest(&valid_manifest).is_ok());

        // Test invalid name
        let mut invalid_manifest = valid_manifest.clone();
        invalid_manifest.name = "invalid/name".to_string();
        assert!(PackagePublisher::validate_manifest(&invalid_manifest).is_err());

        // Test invalid version
        let mut invalid_manifest = valid_manifest.clone();
        invalid_manifest.version = "invalid".to_string();
        assert!(PackagePublisher::validate_manifest(&invalid_manifest).is_err());

        // Test invalid file path
        let mut invalid_manifest = valid_manifest.clone();
        invalid_manifest.files = vec![PathBuf::from("/absolute/path")];
        assert!(PackagePublisher::validate_manifest(&invalid_manifest).is_err());
    }
}
