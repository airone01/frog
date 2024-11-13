use anyhow::Result;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use tokio::fs;
use tracing::warn;

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
        require_write: bool,
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

        // For read-only operations, we only need read+execute (5)
        // For write operations, we need read+write+execute (7)
        let required_mode = if require_write { 0o700 } else { 0o500 };

        if mode & required_mode != required_mode {
            return Err(PermissionError::InsufficientPermissions(
                path.to_path_buf(),
                required_mode,
                mode & 0o777,
            ));
        }

        // Only check write permissions if required
        if require_write {
            // Verify write permissions with a test file
            let test_file = path.join(".diem_permission_test");
            if let Err(e) = fs::write(&test_file, b"test").await {
                warn!("Failed to verify write permissions: {}", e);
                return Err(PermissionError::InsufficientPermissions(
                    path.to_path_buf(),
                    required_mode,
                    mode & 0o777,
                ));
            }
        }

        Ok(())
    }

    /// Convenience method to check both /sgoinfre and /goinfre with appropriate permissions
    pub async fn check_required_permissions() -> Result<(), PermissionError> {
        // For read operations, we don't need write permissions
        Self::check_directory_permissions("/sgoinfre", false).await?;
        Self::check_directory_permissions("/goinfre", false).await?;
        Ok(())
    }

    /// Special version that checks for write permissions
    pub async fn check_write_permissions() -> Result<(), PermissionError> {
        Self::check_directory_permissions("/sgoinfre", true).await?;
        Self::check_directory_permissions("/goinfre", true).await?;
        Ok(())
    }
}

// #[cfg(test)]
// mod tests {
//     use super::*;
//     use tempfile::tempdir;

//     #[tokio::test]
//     async fn test_permission_checker() {
//         // Create a temporary directory for testing
//         let temp_dir = tempdir().unwrap();
//         let temp_path = temp_dir.path();

//         // Test directory permissions check
//         assert!(PermissionChecker::check_directory_permissions(temp_path)
//             .await
//             .is_ok());

//         // Test non-existent directory
//         assert!(matches!(
//             PermissionChecker::check_directory_permissions("/nonexistent/path")
//                 .await
//                 .unwrap_err(),
//             PermissionError::DirectoryNotFound(_)
//         ));

//         // Test directory creation check
//         assert!(
//             PermissionChecker::check_directory_creation(temp_path.join("test_dir"), 0o755)
//                 .await
//                 .is_ok()
//         );
//     }
// }
