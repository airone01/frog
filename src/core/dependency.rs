use anyhow::Result;
use std::collections::{HashMap, HashSet};
use tracing::warn;

use crate::models::{Package, PackageDependency};

use super::validation::SystemValidator;

pub struct DependencyResolver {
    visited: HashSet<String>,
    resolved: HashMap<String, Package>,
    installing: HashSet<String>,
}

impl DependencyResolver {
    pub fn new() -> Self {
        Self {
            visited: HashSet::new(),
            resolved: HashMap::new(),
            installing: HashSet::new(),
        }
    }

    pub async fn resolve_dependencies(&mut self, package: &Package) -> Result<Vec<Package>> {
        self.visited.clear();
        self.resolved.clear();
        self.installing.clear();

        self.resolve_package(package, None).await?;
        Ok(self.resolved.values().cloned().collect())
    }

    async fn resolve_package(&mut self, package: &Package, parent: Option<&Package>) -> Result<()> {
        let key = self.get_package_key(package);

        // Check for circular dependencies
        if self.installing.contains(&key) {
            return Err(anyhow::anyhow!("Circular dependency detected: {}", key));
        }

        // Skip if already resolved
        if self.visited.contains(&key) {
            return Ok(());
        }

        self.installing.insert(key.clone());

        // Validate system compatibility
        SystemValidator::validate_package_requirements(package)?;

        // Resolve all dependencies
        if let Some(deps) = &package.dependencies {
            for dep in deps {
                self.resolve_dependency(dep, package)?;
            }
        }

        // Handle optional dependencies
        if let Some(opt_deps) = &package.optional_dependencies {
            for dep in opt_deps {
                if let Err(e) = self.resolve_dependency(dep, package) {
                    warn!(
                        "Optional dependency {} could not be resolved: {}",
                        dep.name, e
                    );
                }
            }
        }

        self.visited.insert(key.clone());
        self.resolved.insert(key.clone(), package.clone());
        self.installing.remove(&key);

        Ok(())
    }

    fn get_package_key(&self, package: &Package) -> String {
        format!(
            "{}:{}@{}",
            package.provider.as_deref().unwrap_or("default"),
            package.name,
            package.version
        )
    }

    fn resolve_dependency(&self, dep: &PackageDependency, parent: &Package) -> Result<()> {
        // Implementation would depend on your package resolution logic
        todo!("Implement dependency resolution")
    }
}
