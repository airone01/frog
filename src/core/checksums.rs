use anyhow::Result;
use sha2::{Digest, Sha256};
use std::path::Path;
use tokio::fs::File;
use tokio::io::AsyncReadExt;

pub async fn calculate_file_checksum(path: impl AsRef<Path>) -> Result<String> {
    let mut file = File::open(path).await?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).await?;

    let mut hasher = Sha256::new();
    hasher.update(&buffer);
    Ok(format!("{:x}", hasher.finalize()))
}

pub async fn verify_checksum(path: impl AsRef<Path>, expected: &str) -> Result<()> {
    let calculated = calculate_file_checksum(path).await?;
    if calculated != expected {
        return Err(anyhow::anyhow!(
            "Checksum verification failed. Expected: {}, Got: {}",
            expected,
            calculated
        ));
    }
    Ok(())
}
