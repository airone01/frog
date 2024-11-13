use anyhow::Result;
use std::path::Path;
use tokio::fs;

#[derive(Clone)]
pub struct FileSystem;

impl FileSystem {
    pub fn new() -> Self {
        Self
    }

    pub async fn exists(&self, path: impl AsRef<Path>) -> bool {
        path.as_ref().exists()
    }

    pub async fn create_dir_all(&self, path: impl AsRef<Path>) -> Result<()> {
        fs::create_dir_all(path.as_ref()).await?;
        Ok(())
    }

    pub async fn remove_dir_all(&self, path: impl AsRef<Path>) -> Result<()> {
        fs::remove_dir_all(path.as_ref()).await?;
        Ok(())
    }

    pub async fn remove_file(&self, path: impl AsRef<Path>) -> Result<()> {
        fs::remove_file(path.as_ref()).await?;
        Ok(())
    }

    pub async fn copy(&self, from: impl AsRef<Path>, to: impl AsRef<Path>) -> Result<()> {
        fs::copy(from.as_ref(), to.as_ref()).await?;
        Ok(())
    }

    pub async fn read_to_string(&self, path: impl AsRef<Path>) -> Result<String> {
        let content = fs::read_to_string(path.as_ref()).await?;
        Ok(content)
    }

    pub async fn write(&self, path: impl AsRef<Path>, contents: impl AsRef<[u8]>) -> Result<()> {
        fs::write(path.as_ref(), contents.as_ref()).await?;
        Ok(())
    }
}
