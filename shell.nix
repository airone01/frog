{ pkgs ? import <nixpkgs> {} }:

let
  lib = import <nixpkgs/lib>;
  # buildNodeJs = pkgs.callPackage "${<nixpkgs>}/pkgs/development/web/nodejs/nodejs.nix" {
  #   python = pkgs.python3;
  # };

  # nodejsVersion = lib.fileContents ./.nvmrc;

  # nodejs = import ./nix/nodejs.nix {
  #   # enableNpm = false;
  #   version = "12.22.12";
  #   sha256 = "sha256-5tBSNkv6LBfaks8xeUEAz9cJuhR0Fd2u7SIi7snKFGk=";
  # };

  NPM_CONFIG_PREFIX = toString ./npm_config_prefix;

in pkgs.mkShell {
  packages = with pkgs; [
    bash
    bun
  ];

  inherit NPM_CONFIG_PREFIX;

  shellHook = ''
    export PATH="${NPM_CONFIG_PREFIX}/bin:$PATH"

    # Get current username and group
    export CURRENT_USER=$(whoami)
    export CURRENT_GROUP=$(id -gn)

    # Create test directories if they don't exist
    mkdir -p /tmp/sgoinfre/$CURRENT_USER
    mkdir -p /tmp/goinfre/$CURRENT_USER

    # Mount temporary directories
    export MOUNT_SGOINFRE=$(mktemp -d)
    export MOUNT_GOINFRE=$(mktemp -d)

    # Create a 50GB sparse file for goinfre
    truncate -s 50G /tmp/goinfre.img
    mkfs.ext4 /tmp/goinfre.img

    # Bind mount sgoinfre and mount size-limited goinfre
    sudo mount --bind /tmp/sgoinfre $MOUNT_SGOINFRE
    sudo mount -o loop /tmp/goinfre.img $MOUNT_GOINFRE

    # Create symlinks to simulate the real paths
    sudo ln -sfn $MOUNT_SGOINFRE /sgoinfre
    sudo ln -sfn $MOUNT_GOINFRE /goinfre

    # Create user directories in the mounted locations with sudo
    sudo mkdir -p /sgoinfre/$CURRENT_USER
    sudo mkdir -p /goinfre/$CURRENT_USER

    # Set proper ownership using the correct group
    sudo chown $CURRENT_USER:$CURRENT_GROUP /sgoinfre/$CURRENT_USER
    sudo chown $CURRENT_USER:$CURRENT_GROUP /goinfre/$CURRENT_USER

    # Set directory permissions
    sudo chmod 755 /sgoinfre/$CURRENT_USER
    sudo chmod 755 /goinfre/$CURRENT_USER

    # Cleanup function
    cleanup() {
      sudo umount $MOUNT_SGOINFRE
      sudo umount $MOUNT_GOINFRE
      sudo rm -f /sgoinfre /goinfre
      rm -rf /tmp/sgoinfre /tmp/goinfre
      rm -f /tmp/goinfre.img
      rm -rf $MOUNT_SGOINFRE $MOUNT_GOINFRE
    }
    trap cleanup EXIT
  '';
}
