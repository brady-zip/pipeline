#!/bin/bash
set -e

REPO="brady-zip/pipeline"
INSTALL_DIR="$HOME/.local/bin"
CONFIG_DIR="$HOME/.config/pipeline"
ASSET_NAME="pipeline-darwin-arm64"

# Require gh CLI
if ! command -v gh &>/dev/null; then
  echo "error: gh CLI is required (https://cli.github.com)" >&2
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "error: gh CLI not authenticated — run 'gh auth login'" >&2
  exit 1
fi

# Determine version
VERSION="${1:-latest}"

mkdir -p "$INSTALL_DIR"

# Download binary
if [ "$VERSION" = "latest" ]; then
  echo "downloading latest pipeline release..."
  gh release download --repo "$REPO" --pattern "$ASSET_NAME" --output "$INSTALL_DIR/pipeline" --clobber
else
  TAG="$VERSION"
  [[ "$TAG" != v* ]] && TAG="v$TAG"
  echo "downloading pipeline $TAG..."
  gh release download "$TAG" --repo "$REPO" --pattern "$ASSET_NAME" --output "$INSTALL_DIR/pipeline" --clobber
fi

chmod +x "$INSTALL_DIR/pipeline"

# Remove macOS quarantine attribute
xattr -d com.apple.quarantine "$INSTALL_DIR/pipeline" 2>/dev/null || true

# Create default config
mkdir -p "$CONFIG_DIR"
if [ ! -f "$CONFIG_DIR/config.toml" ]; then
  cat > "$CONFIG_DIR/config.toml" <<'TOML'
[updates]
auto_update = true
pinned_version = ""
TOML
  echo "created config at $CONFIG_DIR/config.toml"
fi

echo "installed pipeline to $INSTALL_DIR/pipeline"

# Check PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo ""
  echo "warning: $INSTALL_DIR is not in your \$PATH"
  echo "add this to your shell profile:"
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
