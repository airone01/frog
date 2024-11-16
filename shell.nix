{ pkgs ? import <nixpkgs> {} }:

let
  username = builtins.getEnv "USER";

  # Create a sample package.json for eza
  ezaPackageJson = pkgs.writeTextFile {
    name = "eza-package.json";
    text = builtins.toJSON {
      name = "eza";
      version = "0.20.7";
      provider = "nixuser";
      binaries = [ "eza" ];
      url = "https://github.com/eza-community/eza/releases/download/v0.20.7/eza_x86_64-unknown-linux-gnu.tar.gz";
      checksum = "d6f12a146192e9b4d4a33a37172af520aa830611bb606ceffad8dca9e363b4f2";
    };
  };

  # Create registry.json
  registryJson = pkgs.writeTextFile {
    name = "registry.json";
    text = builtins.toJSON {
      providers = [ "nixuser" ];
      default_provider = "nixuser";
    };
  };

  # Setup script to create required directories and populate registry
  setupScript = pkgs.writeScriptBin "setup-diem-env" ''
    #!${pkgs.stdenv.shell}

    # Create required directories
    mkdir -p /goinfre/${username}
    mkdir -p /sgoinfre/${username}
    mkdir -p /sgoinfre/${username}/nixuser
    mkdir -p /sgoinfre/${username}/packages
    mkdir -p /sgoinfre/${username}/.config

    # Set permissions
    chmod 755 /goinfre/${username}
    chmod 755 /sgoinfre/${username}
    chmod 755 /sgoinfre/${username}/nixuser
    chmod 755 /sgoinfre/${username}/packages
    chmod 755 /sgoinfre/${username}/.config

    # Create eza package directory
    mkdir -p /sgoinfre/${username}/nixuser/eza

    # Copy package.json
    cp ${ezaPackageJson} /sgoinfre/${username}/nixuser/eza/package.json

    # Copy registry.json
    cp ${registryJson} /sgoinfre/${username}/.config/registry.json

    echo "Development environment setup complete!"
  '';

in
pkgs.mkShell {
  buildInputs = with pkgs; [
    # Rust toolchain
    rustc
    cargo
    rustfmt
    clippy
    rust-analyzer

    # Build dependencies
    pkg-config
    openssl
    openssl.dev

    # Runtime dependencies
    curl
    wget
    gnutar
    gzip

    # Development tools
    git

    # Our custom setup script
    setupScript
  ];

  shellHook = ''
    echo "Setting up Diem development environment..."
    setup-diem-env

    # Set SSL cert file for OpenSSL
    export SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt

    # Add cargo binary directory to PATH
    export PATH="$HOME/.cargo/bin:$PATH"

    echo "Development environment ready!"
  '';

  # Set environment variables
  RUST_SRC_PATH = "${pkgs.rust.packages.stable.rustPlatform.rustLibSrc}";
}
