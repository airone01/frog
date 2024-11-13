use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Provider {
    pub username: String,
    pub path: PathBuf,
}

impl Provider {
    pub fn new(username: String, sgoinfre_path: &Path) -> Self {
        Self {
            path: sgoinfre_path.join(&username),
            username,
        }
    }

    pub fn is_valid(&self) -> bool {
        self.path.exists()
    }
}
