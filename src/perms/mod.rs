use anyhow::Result;
use std::fs::Permissions;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use tokio::fs;
use tracing::{debug, warn};

#[derive(Debug, thiserror::Error)]
pub enum PermissionError {
    #[error("Directory {0} does not exist")]
    DirectoryNotFound(PathBuf),

    #[error("Insufficient permissions for {0}. Required: {1}, Current: {2}")]
    InsufficientPermissions(PathBuf, u32, u32),

    #[error("Not a directory: {0}")]
    NotADirectory(PathBuf),

    #[error("Unable to determine ownership of {0}")]
    OwnershipCheckFailed(PathBuf),

    #[error("Directory {0} is not owned by current user")]
    InvalidOwnership(PathBuf),

    #[error("Unable to access path: {0}")]
    AccessError(PathBuf),
}

pub struct PermissionChecker;

impl PermissionChecker {
    /// Checks if the current process has sufficient permissions to access and modify
    /// the given directory. Returns Ok(()) if all checks pass, or a PermissionError
    /// detailing why access is denied.
    pub async fn check_directory_permissions(
        path: impl AsRef<Path>,
    ) -> Result<(), PermissionError> {
        let path = path.as_ref();

        // Check if directory exists
        if !path.exists() {
            return Err(PermissionError::DirectoryNotFound(path.to_path_buf()));
        }

        // Verify it's actually a directory
        let metadata = fs::metadata(path)
            .await
            .map_err(|_| PermissionError::AccessError(path.to_path_buf()))?;

        if !metadata.is_dir() {
            return Err(PermissionError::NotADirectory(path.to_path_buf()));
        }

        // Check basic Unix permissions
        let permissions = metadata.permissions();
        let mode = permissions.mode();

        // We need read/write/execute permissions (7)
        let required_mode = 0o700;
        if mode & required_mode != required_mode {
            return Err(PermissionError::InsufficientPermissions(
                path.to_path_buf(),
                required_mode,
                mode & 0o777,
            ));
        }

        // Check ownership
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let uid = metadata.uid();
            let current_uid = unsafe { libc::getuid() };

            if uid != current_uid {
                return Err(PermissionError::InvalidOwnership(path.to_path_buf()));
            }
        }

        // Verify write permissions with a test file
        let test_file = path.join(".diem_permission_test");
        match Self::test_write_permissions(&test_file).await {
            Ok(_) => {
                debug!(
                    "Successfully verified write permissions for {}",
                    path.display()
                );
                Ok(())
            }
            Err(e) => {
                warn!("Failed to verify write permissions: {}", e);
                Err(PermissionError::InsufficientPermissions(
                    path.to_path_buf(),
                    required_mode,
                    mode & 0o777,
                ))
            }
        }
    }

    /// Tests write permissions by attempting to create and remove a test file
    async fn test_write_permissions(test_file: &Path) -> Result<(), std::io::Error> {
        // Try to create test file
        fs::write(test_file, b"test").await?;

        // Clean up
        fs::remove_file(test_file).await?;

        Ok(())
    }

    /// Convenience method to check both /sgoinfre and /goinfre
    pub async fn check_required_permissions() -> Result<(), PermissionError> {
        for path in ["/sgoinfre", "/goinfre"] {
            Self::check_directory_permissions(path).await?;
        }
        Ok(())
    }

    /// Checks if the current process can create a directory with specific permissions
    pub async fn check_directory_creation(
        path: impl AsRef<Path>,
        mode: u32,
    ) -> Result<(), PermissionError> {
        let path = path.as_ref();

        // Create test directory
        fs::create_dir_all(path)
            .await
            .map_err(|_| PermissionError::AccessError(path.to_path_buf()))?;

        // Set permissions
        fs::set_permissions(path, Permissions::from_mode(mode))
            .await
            .map_err(|_| PermissionError::InsufficientPermissions(path.to_path_buf(), mode, 0))?;

        // Clean up
        fs::remove_dir(path)
            .await
            .map_err(|_| PermissionError::AccessError(path.to_path_buf()))?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_permission_checker() {
        // Create a temporary directory for testing
        let temp_dir = tempdir().unwrap();
        let temp_path = temp_dir.path();

        // Test directory permissions check
        assert!(PermissionChecker::check_directory_permissions(temp_path)
            .await
            .is_ok());

        // Test non-existent directory
        assert!(matches!(
            PermissionChecker::check_directory_permissions("/nonexistent/path")
                .await
                .unwrap_err(),
            PermissionError::DirectoryNotFound(_)
        ));

        // Test directory creation check
        assert!(
            PermissionChecker::check_directory_creation(temp_path.join("test_dir"), 0o755)
                .await
                .is_ok()
        );
    }
}
