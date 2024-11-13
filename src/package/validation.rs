use super::error::PackageError;
use anyhow::Result;
use base64::{engine::general_purpose, Engine as _};
use openssl::hash::MessageDigest;
use openssl::pkey::PKey;
use openssl::sign::Verifier;
use std::path::Path;
use tokio::fs;

pub struct PackageValidator;

impl PackageValidator {
    pub fn new() -> Self {
        Self
    }

    pub async fn verify_signature(
        &self,
        file_path: &Path,
        signature: &str,
        public_key: &str,
    ) -> Result<()> {
        let file_content = fs::read(file_path).await?;
        let signature = general_purpose::STANDARD.decode(signature)?;
        let pkey = PKey::public_key_from_pem(public_key.as_bytes())?;

        let mut verifier = Verifier::new(MessageDigest::sha256(), &pkey)?;
        verifier.update(&file_content)?;

        if !verifier.verify(&signature)? {
            return Err(PackageError::SignatureValidationFailed.into());
        }

        Ok(())
    }
}
