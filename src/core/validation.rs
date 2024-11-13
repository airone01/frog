use anyhow::Result;
use semver::Version;
use std::env::consts::{ARCH, OS};
use tracing::warn;

use crate::models::Package;

pub struct SystemValidator;

impl SystemValidator {
    pub fn validate_package_requirements(package: &Package) -> Result<()> {
        // Validate OS compatibility
        if let Some(supported_os) = &package.os {
            if !supported_os.iter().any(|os| os == OS) {
                return Err(anyhow::anyhow!(
                    "Package is not compatible with {} operating system",
                    OS
                ));
            }
        }

        // Validate architecture compatibility
        if let Some(supported_arch) = &package.cpu {
            if !supported_arch.iter().any(|arch| arch == ARCH) {
                return Err(anyhow::anyhow!(
                    "Package is not compatible with {} architecture",
                    ARCH
                ));
            }
        }

        // Validate version constraints
        if let Some(engines) = &package.engines {
            if let Some(node_version) = &engines.node {
                if let Ok(current_node) = std::env::var("NODE_VERSION") {
                    if !semver::VersionReq::parse(node_version)?
                        .matches(&Version::parse(&current_node)?)
                    {
                        warn!("Node.js version requirement not met: {}", node_version);
                    }
                }
            }

            if let Some(bun_version) = &engines.bun {
                if let Ok(current_bun) = std::env::var("BUN_VERSION") {
                    if !semver::VersionReq::parse(bun_version)?
                        .matches(&Version::parse(&current_bun)?)
                    {
                        warn!("Bun version requirement not met: {}", bun_version);
                    }
                }
            }
        }

        Ok(())
    }
}
