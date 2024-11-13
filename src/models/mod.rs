use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Package {
    pub name: String,
    pub version: String,
    pub provider: Option<String>,
    pub binaries: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_script: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checksum: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dependencies: Option<Vec<PackageDependency>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peer_dependencies: Option<Vec<PackageDependency>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub optional_dependencies: Option<Vec<PackageDependency>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engines: Option<Engines>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageDependency {
    pub name: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub optional: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Engines {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bun: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PackageReference {
    pub provider: String,
    pub name: String,
}
