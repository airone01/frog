<h1 align="center">
  <img src="./.github/assets/diem_logo.svg">
</h1>

<p align="center">
  <i align="center">Diem Is an Environment Manager</i> for students of 42
</p>

<h4 align="center">
  <a href="https://profile.intra.42.fr/users/elagouch"><img alt="School 42 badge" src="https://img.shields.io/badge/ft__love-020617?style=flat&labelColor=020617&color=5a45fe&logo=42"></a>
  <img alt="GitHub package.json version" src="https://img.shields.io/github/package-json/v/airone01/diem?style=flat&labelColor=020617&color=5a45fe">
  <img alt="GitHub contributors" src="https://img.shields.io/github/contributors-anon/airone01/diem?style=flat&labelColor=020617&color=5a45fe">
  <img alt="GitHub last commit" src="https://img.shields.io/github/last-commit/airone01/diem?style=flat&labelColor=020617&color=5a45fe">
</h4>

```
📦 diem
├── Cargo.toml
├── README.md
├── .*                         # Configuration files
├── src
│   ├── main.rs                # Entry point
│   ├── cli.rs                 # CLI argument handling
│   ├── package
│   │   ├── mod.rs             # Package module definitions
│   │   ├── manifest.rs        # Package manifest handling
│   │   ├── dependency.rs      # Dependency resolution logic
│   │   └── version.rs         # Version parsing and comparison
│   ├── repository
│   │   ├── mod.rs             # Repository module definitions
│   │   ├── config.rs          # Repository configuration
│   │   ├── storage.rs         # Package storage handling
│   │   ├── source.rs          # Source management (add/remove/list)
│   │   ├── discovery.rs       # Package discovery across sources
│   │   └── sync.rs            # Repository synchronization
│   ├── config
│   │   ├── mod.rs             # Configuration module definitions
│   │   ├── settings.rs        # Global settings management
│   │   └── sources.rs         # Source list configuration
│   └── utils
│       ├── mod.rs             # Utility module definitions
│       ├── hash.rs            # Hash calculation utilities
│       ├── http.rs            # HTTP client utilities
│       └── validation.rs      # Source validation utilities
├── tests
│   ├── integration_tests.rs   # Integration tests
│   ├── source_tests.rs        # Source management tests
│   └── test_data              # Test fixtures
├── examples                   # Example usage
└── docs                       # Documentation
    ├── sources.md             # Source configuration documentation
    └── config.md              # Configuration documentation
```

NOTE: "Disk Quota Exceeded" error CAN and WILL happen on sgoinfre because the architecture of the filesystem is not designed to handle a large number of small files. This is a known issue and there is no fix for it. The only solution is to wait for admins to clear the disk space.
TODO: Add a note about this when the error occurs.

## Features

TODO

## Installation

TODO

## Usage

TODO

## Hosting/adding packages

TODO

## 📋 Roadmap

| Category | Task | Priority | Status |
|----------|------|----------|--------|
| Feature | Package installation | High | 🟡 Pending |

Legend:
- 🟢 Complete
- 🟡 In Progress/Partial
- 🔴 Not Started

## Contributing

TODO

<p align="center">
  <a href="https://en.wikipedia.org/wiki/Carpe_diem"><i align="center"><sub>Carpe Diem 🤘</sub></i></a>
</p>
