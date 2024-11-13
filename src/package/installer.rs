use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tracing::{debug, info, warn};

use super::error::PackageError;
use super::validation::PackageValidator;
use crate::config::Config;
use crate::fs::FileSystem;
use crate::models::Package;
use crate::models::PackageReference;
use crate::perms::PermissionChecker;
use std::fs::Permissions;
use std::os::unix::fs::PermissionsExt;

pub struct PackageInstaller {
    config: Config,
    fs: FileSystem,
    temp_dir: PathBuf,
    validator: PackageValidator,
}

impl PackageInstaller {
    pub fn new(config: &Config, fs: &FileSystem) -> Self {
        let temp_dir = config.temp_dir().join("diem-tmp");

        Self {
            config: config.clone(),
            fs: fs.clone(),
            temp_dir,
            validator: PackageValidator::new(),
        }
    }

    pub async fn install(
        &self,
        package: &Package,
        reference: &PackageReference,
        force: bool,
    ) -> anyhow::Result<()> {
        // Verify permissions before installation
        PermissionChecker::check_required_permissions().await?;

        // Check specific directory permissions
        PermissionChecker::check_directory_permissions(&self.config.package_root()).await?;
        PermissionChecker::check_directory_permissions(&self.config.binaries_path()).await?;

        // Rest of the installation process...
        let _lock = self.acquire_install_lock(reference).await?;
        info!(
            "Installing package {} with verified permissions",
            package.name
        );

        info!("Installing package {}", package.name);

        // Prepare directories
        let package_dir = self.get_package_directory(reference);
        let temp_dir = self.create_temp_directory(reference).await?;
        self.prepare_directory(&package_dir).await?;

        // Download and validate if URL is present
        if let Some(_url) = &package.url {
            self.download_and_validate_package(package, &temp_dir, &package_dir)
                .await?;
        }

        // Run install script if present
        if let Some(script) = &package.install_script {
            self.run_install_script_sandboxed(script, &package_dir)
                .await?;
        }

        // Create symlinks
        self.create_symlinks(&package.binaries, &package_dir, force)
            .await?;

        info!("Successfully installed {}", package.name);
        Ok(())
    }

    pub async fn list_installed(&self) -> anyhow::Result<Vec<Package>> {
        let mut installed = Vec::new();
        let mut entries = fs::read_dir(self.config.package_root()).await?;

        while let Some(entry) = entries.next_entry().await? {
            if !entry.file_type().await?.is_dir() {
                continue;
            }

            let package_json = entry.path().join("package.json");
            if !package_json.exists() {
                continue;
            }

            match fs::read_to_string(&package_json).await {
                Ok(content) => {
                    if let Ok(package) = serde_json::from_str::<Package>(&content) {
                        installed.push(package);
                    }
                }
                Err(e) => {
                    warn!(
                        "Failed to read package.json at {}: {}",
                        package_json.display(),
                        e
                    );
                }
            }
        }

        Ok(installed)
    }

    async fn download_and_validate_package(
        &self,
        package: &Package,
        temp_dir: &Path,
        final_dir: &Path,
    ) -> Result<(), anyhow::Error> {
        let url = package
            .url
            .as_ref()
            .ok_or_else(|| PackageError::MissingUrl(package.name.clone()))?;

        let download_path = temp_dir.join("package.tar.gz");
        debug!("Downloading package from {}", url);

        let response = reqwest::get(url).await?;
        if !response.status().is_success() {
            return Err(PackageError::DownloadFailed(
                package.name.clone(),
                response.status().to_string(),
            )
            .into());
        }
        let mut file = fs::File::create(&download_path).await?;
        let bytes = response.bytes().await?;
        let mut stream = bytes.chunks(8192);
        let mut hasher = Sha256::new();

        while let Some(chunk) = stream.next() {
            hasher.update(&chunk);
            file.write_all(&chunk).await?;
        }

        // Validate checksum if provided
        if let Some(expected_checksum) = &package.checksum {
            let calculated_hash = format!("{:x}", hasher.finalize());
            if calculated_hash != *expected_checksum {
                return Err(PackageError::ChecksumMismatch {
                    expected: expected_checksum.clone(),
                    actual: calculated_hash,
                }
                .into());
            }
        }

        // Validate signature if provided
        if let (Some(signature), Some(public_key)) = (&package.signature, &package.public_key) {
            self.validator
                .verify_signature(&download_path, signature, public_key)
                .await?;
        }

        // Extract package
        self.extract_package(&download_path, final_dir).await?;
        Ok(())
    }

    async fn run_install_script_sandboxed(&self, script: &str, cwd: &Path) -> anyhow::Result<()> {
        debug!("Running install script in sandbox");

        // Create temporary script file
        let script_path = self.temp_dir.join("install.sh");
        fs::write(&script_path, script).await?;
        fs::set_permissions(&script_path, Permissions::from_mode(0o755)).await?;

        // Run script in restricted environment
        let output = Command::new("bash")
            .arg(&script_path)
            .current_dir(cwd)
            .env_clear()
            .env("PATH", "/usr/local/bin:/usr/bin:/bin")
            .env("HOME", cwd)
            .env("TEMP", &self.temp_dir)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(PackageError::InstallScriptFailed(stderr.to_string()).into());
        }

        // Cleanup
        fs::remove_file(script_path).await?;
        Ok(())
    }

    async fn extract_package(&self, archive_path: &Path, destination: &Path) -> anyhow::Result<()> {
        let status = Command::new("tar")
            .args(&[
                "--strip-components=1",
                "-xzf",
                &archive_path.to_string_lossy(),
                "-C",
                &destination.to_string_lossy(),
            ])
            .status()
            .await?;

        if !status.success() {
            return Err(PackageError::ExtractionFailed.into());
        }

        Ok(())
    }

    async fn create_symlinks(
        &self,
        binaries: &[String],
        package_dir: &Path,
        force: bool,
    ) -> anyhow::Result<()> {
        for binary in binaries {
            let source = package_dir.join(binary);
            let target = self.config.binaries_path().join(binary);

            if target.exists() {
                if !force {
                    return Err(PackageError::BinaryExists(binary.clone()).into());
                }
                fs::remove_file(&target).await?;
            }

            std::os::unix::fs::symlink(&source, &target)?;
            fs::set_permissions(&source, Permissions::from_mode(0o755)).await?;
        }

        Ok(())
    }

    async fn acquire_install_lock(
        &self,
        reference: &PackageReference,
    ) -> anyhow::Result<InstallLock> {
        let lock_file = self.temp_dir.join(format!("{}.lock", reference.name));

        if lock_file.exists() {
            return Err(PackageError::InstallLocked(reference.name.clone()).into());
        }

        fs::write(&lock_file, std::process::id().to_string()).await?;
        Ok(InstallLock { path: lock_file })
    }

    fn get_package_directory(&self, reference: &PackageReference) -> PathBuf {
        let dir_name = format!("{}_{}", reference.provider, reference.name);
        self.config.package_root().join(dir_name)
    }

    async fn create_temp_directory(&self, reference: &PackageReference) -> anyhow::Result<PathBuf> {
        let dir = self.temp_dir.join(&reference.name);
        fs::create_dir_all(&dir).await?;
        Ok(dir)
    }

    async fn prepare_directory(&self, dir: &Path) -> anyhow::Result<()> {
        fs::create_dir_all(dir).await?;
        Ok(())
    }
}

// Installation lock guard
struct InstallLock {
    path: PathBuf,
}

impl Drop for InstallLock {
    fn drop(&mut self) {
        // Clean up lock file on drop
        let _ = std::fs::remove_file(&self.path);
    }
}
