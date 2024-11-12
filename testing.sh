#!/bin/sh

# Configuration
USERNAME=$(whoami)
SGOINFRE_PATH="/sgoinfre/${USERNAME}"
REGISTRY_PATH="${SGOINFRE_PATH}/packages"
EZA_VERSION="0.20.7"
EZA_URL="https://github.com/eza-community/eza/releases/download/v${EZA_VERSION}/eza_x86_64-unknown-linux-gnu.tar.gz"
EZA_PACKAGE_PATH="${REGISTRY_PATH}/eza"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Setting up registry for user ${USERNAME}...${NC}"

# Create necessary directories
echo "Creating registry directories..."
mkdir -p "${REGISTRY_PATH}"
mkdir -p "${EZA_PACKAGE_PATH}"

# Download eza
echo "Downloading eza v${EZA_VERSION}..."
if ! curl -L "${EZA_URL}" -o "/tmp/eza.tar.gz"; then
    echo -e "${RED}Failed to download eza${NC}"
    exit 1
fi

# Extract eza
echo "Extracting eza..."
if ! tar -xzf "/tmp/eza.tar.gz" -C "/tmp"; then
    echo -e "${RED}Failed to extract eza${NC}"
    rm -f "/tmp/eza.tar.gz"
    exit 1
fi

# Move binary to package directory
echo "Setting up eza package..."
mv "/tmp/eza" "${EZA_PACKAGE_PATH}/eza"

# Create package.json
cat > "${EZA_PACKAGE_PATH}/package.json" << EOF
{
  "name": "eza",
  "version": "${EZA_VERSION}",
  "binaries": ["eza"],
  "description": "A modern, maintained replacement for ls"
}
EOF

# Cleanup
rm -f "/tmp/eza.tar.gz"

# Set permissions
chmod 755 "${EZA_PACKAGE_PATH}/eza"
chmod -R 755 "${REGISTRY_PATH}"

echo -e "${GREEN}Registry setup complete!${NC}"
echo
echo "To use this registry:"
echo "1. Add your registry to frog:"
echo -e "${YELLOW}frog provider add ${USERNAME}${NC}"
echo
echo "2. Set as default provider (optional):"
echo -e "${YELLOW}frog provider default ${USERNAME}${NC}"
echo
echo "3. Install eza:"
echo -e "${YELLOW}frog install ${USERNAME}:eza${NC}"
echo "   or (if set as default provider):"
echo -e "${YELLOW}frog install eza${NC}"
