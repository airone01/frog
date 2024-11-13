pub mod error;
pub mod installer;
pub mod uninstaller;
pub mod validation;

// Re-export main types
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UninstallationStatus {
    pub package_name: String,
    pub success: bool,
    pub error_message: Option<String>,
    pub backup_created: bool,
    pub symlinks_removed: bool,
    pub files_removed: bool,
    pub goinfre_cleaned: bool,
    pub registry_updated: bool,
}

impl UninstallationStatus {
    pub fn new(package_name: &str) -> Self {
        Self {
            package_name: package_name.to_string(),
            success: false,
            error_message: None,
            backup_created: false,
            symlinks_removed: false,
            files_removed: false,
            goinfre_cleaned: false,
            registry_updated: false,
        }
    }

    pub fn mark_success(&mut self) {
        self.success = true;
    }

    pub fn set_error(&mut self, error: &str) {
        self.success = false;
        self.error_message = Some(error.to_string());
    }
}
