#!/bin/bash

# WorkAny Build Script
# Usage: ./scripts/build.sh [platform] [--with-claude]
# Platforms: linux, windows, mac-intel, mac-arm, all
# Options:
#   --with-claude  Bundle Claude Code CLI as a sidecar (for users without Node.js environment)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Global variables
BUNDLE_CLI=false  # Bundle CLI tools (Claude Code + Codex) with shared Node.js
BUILD_PLATFORM="current"
SKIP_SIGNING=true  # Default: skip signing for faster builds

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if required tools are installed
check_requirements() {
    log_info "Checking requirements..."

    if ! command -v pnpm &> /dev/null; then
        log_error "pnpm is not installed. Please install it first."
        exit 1
    fi

    if ! command -v cargo &> /dev/null; then
        log_error "Rust/Cargo is not installed. Please install it first."
        exit 1
    fi

    if ! command -v rustup &> /dev/null; then
        log_error "rustup is not installed. Please install it first."
        exit 1
    fi

    log_info "All requirements satisfied."
}

# Install dependencies
install_deps() {
    log_info "Installing dependencies..."
    pnpm install
}

# Build API sidecar for a specific target (using Node.js + esbuild + pkg)
build_api_sidecar() {
    local target="$1"
    log_info "Building API sidecar for $target (Node.js)..."

    cd "$PROJECT_ROOT/src-api"

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        pnpm install
    fi

    case "$target" in
        x86_64-unknown-linux-gnu)
            pnpm run build:binary:linux
            ;;
        x86_64-pc-windows-msvc)
            pnpm run build:binary:windows
            ;;
        x86_64-apple-darwin)
            pnpm run build:binary:mac-intel
            ;;
        aarch64-apple-darwin)
            pnpm run build:binary:mac-arm
            ;;
        current)
            pnpm run build:binary
            ;;
        *)
            log_error "Unknown target for API sidecar: $target"
            exit 1
            ;;
    esac

    cd "$PROJECT_ROOT"
    log_info "API sidecar build completed for $target"
}

# Bundle CLI tools (Claude Code + Codex) with shared Node.js runtime
# This creates a single cli-bundle with one Node.js and both CLI packages
bundle_cli_tools() {
    local target="$1"

    if [ "$BUNDLE_CLI" != "true" ]; then
        log_info "Skipping CLI bundling (use --with-cli to enable)"
        return 0
    fi

    log_info "Bundling CLI tools with shared Node.js for $target..."

    local output_dir="$PROJECT_ROOT/src-api/dist"
    local bundle_dir="$output_dir/cli-bundle"

    # Clean up old bundles
    rm -rf "$bundle_dir"
    rm -rf "$output_dir/claude-bundle"
    rm -rf "$output_dir/codex-bundle"
    mkdir -p "$bundle_dir"

    # Determine platform-specific settings
    local node_platform=""
    local node_arch=""
    local node_ext=""

    case "$target" in
        x86_64-unknown-linux-gnu)
            node_platform="linux"
            node_arch="x64"
            ;;
        x86_64-pc-windows-msvc)
            node_platform="win"
            node_arch="x64"
            node_ext=".exe"
            ;;
        x86_64-apple-darwin)
            node_platform="darwin"
            node_arch="x64"
            ;;
        aarch64-apple-darwin)
            node_platform="darwin"
            node_arch="arm64"
            ;;
        current)
            local os_name=$(uname -s)
            local arch=$(uname -m)
            case "$os_name" in
                Darwin)
                    node_platform="darwin"
                    node_arch=$([ "$arch" = "arm64" ] && echo "arm64" || echo "x64")
                    ;;
                Linux)
                    node_platform="linux"
                    node_arch="x64"
                    ;;
                *)
                    node_platform="linux"
                    node_arch="x64"
                    ;;
            esac
            ;;
        *)
            node_platform="linux"
            node_arch="x64"
            ;;
    esac

    # Node.js version - fixed for stability
    local node_version="22.2.0"
    local node_filename="node-v${node_version}-${node_platform}-${node_arch}"
    local node_url="https://nodejs.org/dist/v${node_version}/${node_filename}.tar.gz"

    # For Windows, use .zip format
    if [ "$node_platform" = "win" ]; then
        node_url="https://nodejs.org/dist/v${node_version}/${node_filename}.zip"
    fi

    # Cache directory for Node.js downloads
    local cache_dir="$HOME/.workany/cache"
    local cached_node="$cache_dir/${node_filename}/node${node_ext}"
    mkdir -p "$cache_dir"

    # Check if we have a cached Node.js binary
    if [ -f "$cached_node" ]; then
        log_info "Using cached Node.js v${node_version} for ${node_platform}-${node_arch}"
        cp "$cached_node" "$bundle_dir/node${node_ext}"
        chmod +x "$bundle_dir/node${node_ext}" 2>/dev/null || true
    else
        log_info "Downloading Node.js v${node_version} for ${node_platform}-${node_arch}..."

        local temp_dir=$(mktemp -d)
        cd "$temp_dir"

        local download_success=false

        # Try to download
        if [ "$node_platform" = "win" ]; then
            if curl -fsSL "$node_url" -o node.zip 2>/dev/null; then
                unzip -q node.zip
                cp "${node_filename}/node.exe" "$bundle_dir/node.exe"
                # Cache for future builds
                mkdir -p "$cache_dir/${node_filename}"
                cp "${node_filename}/node.exe" "$cache_dir/${node_filename}/node.exe"
                download_success=true
            fi
        else
            if curl -fsSL "$node_url" | tar xz 2>/dev/null; then
                cp "${node_filename}/bin/node" "$bundle_dir/node"
                chmod +x "$bundle_dir/node"
                # Cache for future builds
                mkdir -p "$cache_dir/${node_filename}"
                cp "${node_filename}/bin/node" "$cache_dir/${node_filename}/node"
                download_success=true
            fi
        fi

        # Fallback to local node if download fails
        if [ "$download_success" != "true" ]; then
            log_warn "Failed to download Node.js, trying local node..."
            if command -v node &> /dev/null; then
                cp "$(which node)" "$bundle_dir/node${node_ext}"
                chmod +x "$bundle_dir/node${node_ext}" 2>/dev/null || true
            else
                log_error "Node.js not available"
                cd "$PROJECT_ROOT"
                rm -rf "$temp_dir"
                return 1
            fi
        else
            log_info "Node.js cached at $cache_dir/${node_filename}/"
        fi

        cd "$PROJECT_ROOT"
        rm -rf "$temp_dir"
    fi

    # Note: npm is NOT bundled - Live Preview requires system Node.js/npm
    # This keeps the bundle size smaller and avoids V8 compatibility issues
    # Users without Node.js will only have Static Preview available

    # Verify Node.js binary
    if [ ! -f "$bundle_dir/node${node_ext}" ]; then
        log_error "Node.js binary not found"
        return 1
    fi

    log_info "Node.js binary ready"

    # Install both CLI packages
    cd "$bundle_dir"
    echo '{"name":"cli-bundle","private":true,"type":"module"}' > package.json

    log_info "Installing @anthropic-ai/claude-code and @openai/codex..."
    npm install @anthropic-ai/claude-code @openai/codex --registry="${NPM_REGISTRY:-https://registry.npmmirror.com}" 2>&1 | tail -15

    # Verify installations
    if [ ! -f "node_modules/@anthropic-ai/claude-code/cli.js" ]; then
        log_error "Claude Code installation failed"
        cd "$PROJECT_ROOT"
        return 1
    fi

    if [ ! -f "node_modules/@openai/codex/bin/codex.js" ]; then
        log_error "Codex installation failed"
        cd "$PROJECT_ROOT"
        return 1
    fi

    log_info "Both CLI packages installed successfully"

    # Clean up unused platform-specific vendor binaries
    # This reduces bundle size significantly (keeping only the target platform)
    log_info "Cleaning up unused platform binaries..."

    # Determine which platform dirs to keep for each package
    local codex_keep=""      # @openai/codex uses: aarch64-apple-darwin, x86_64-apple-darwin, etc.
    local claude_keep=""     # @anthropic-ai/claude-code uses: arm64-darwin, x64-darwin, etc.

    case "$target" in
        x86_64-unknown-linux-gnu)
            codex_keep="x86_64-unknown-linux-musl"
            claude_keep="x64-linux"
            ;;
        x86_64-pc-windows-msvc)
            codex_keep="x86_64-pc-windows-msvc"
            claude_keep="x64-win32"
            ;;
        x86_64-apple-darwin)
            codex_keep="x86_64-apple-darwin"
            claude_keep="x64-darwin"
            ;;
        aarch64-apple-darwin)
            codex_keep="aarch64-apple-darwin"
            claude_keep="arm64-darwin"
            ;;
        current)
            local os_name=$(uname -s)
            local arch=$(uname -m)
            case "$os_name" in
                Darwin)
                    if [ "$arch" = "arm64" ]; then
                        codex_keep="aarch64-apple-darwin"
                        claude_keep="arm64-darwin"
                    else
                        codex_keep="x86_64-apple-darwin"
                        claude_keep="x64-darwin"
                    fi
                    ;;
                Linux)
                    codex_keep="x86_64-unknown-linux-musl"
                    claude_keep="x64-linux"
                    ;;
                *)
                    codex_keep="x86_64-unknown-linux-musl"
                    claude_keep="x64-linux"
                    ;;
            esac
            ;;
    esac

    # Clean @openai/codex vendor directory
    local codex_vendor="node_modules/@openai/codex/vendor"
    if [ -d "$codex_vendor" ] && [ -n "$codex_keep" ]; then
        log_info "Cleaning @openai/codex vendor (keeping $codex_keep)..."
        for dir in "$codex_vendor"/*; do
            local dirname=$(basename "$dir")
            if [ "$dirname" != "$codex_keep" ] && [ -d "$dir" ]; then
                rm -rf "$dir"
                log_info "  Removed codex/vendor/$dirname"
            fi
        done
    fi

    # Clean @anthropic-ai/claude-code vendor/ripgrep directory
    local claude_rg_vendor="node_modules/@anthropic-ai/claude-code/vendor/ripgrep"
    if [ -d "$claude_rg_vendor" ] && [ -n "$claude_keep" ]; then
        log_info "Cleaning @anthropic-ai/claude-code vendor/ripgrep (keeping $claude_keep)..."
        for item in "$claude_rg_vendor"/*; do
            local itemname=$(basename "$item")
            # Keep the target platform dir and any non-directory files (like COPYING)
            if [ -d "$item" ] && [ "$itemname" != "$claude_keep" ]; then
                rm -rf "$item"
                log_info "  Removed claude-code/vendor/ripgrep/$itemname"
            fi
        done
    fi

    log_info "Platform cleanup completed"

    # Copy .wasm files to bundle root (some may be needed at runtime)
    cp node_modules/@anthropic-ai/claude-code/*.wasm . 2>/dev/null || true

    # Sign all native modules and binaries for macOS notarization
    # Apple notarization requires:
    # 1. All binaries signed with Developer ID certificate
    # 2. Secure timestamp included
    # 3. Hardened runtime enabled
    if [ "$node_platform" = "darwin" ] && [ "$SKIP_SIGNING" != "true" ]; then
        log_info "Signing all Mach-O binaries for macOS notarization..."

        # Get signing identity from environment or use default
        local signing_identity="${APPLE_SIGNING_IDENTITY:-Developer ID Application}"

        # Find and sign ALL Mach-O binary files (not just by extension)
        find . -type f | while read -r file; do
            if file "$file" 2>/dev/null | grep -q "Mach-O"; then
                log_info "  Signing: $file"
                codesign --force --timestamp --options runtime --sign "$signing_identity" "$file" 2>&1 || {
                    log_warn "  Failed to sign $file, trying with specific identity..."
                    local identity=$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/')
                    if [ -n "$identity" ]; then
                        codesign --force --timestamp --options runtime --sign "$identity" "$file"
                    fi
                }
            fi
        done

        log_info "Native module signing completed"
    fi

    cd "$PROJECT_ROOT"

    # Create launcher scripts for both CLIs
    create_cli_launcher "$output_dir" "$node_platform" "claude" "@anthropic-ai/claude-code/cli.js" "$target"
    create_cli_launcher "$output_dir" "$node_platform" "codex" "@openai/codex/bin/codex.js" "$target"

    # Verify
    local bundle_size=$(du -sh "$bundle_dir" 2>/dev/null | cut -f1)
    log_info "CLI bundling completed for $target"
    log_info "Bundle size: $bundle_size (shared Node.js + both CLIs)"
}

# Helper function to create launcher scripts
create_cli_launcher() {
    local output_dir="$1"
    local node_platform="$2"
    local cli_name="$3"
    local cli_path="$4"
    local target="$5"

    local output_name="$cli_name"
    if [ "$node_platform" = "win" ]; then
        output_name="${cli_name}.cmd"
        # Windows batch launcher
        cat > "$output_dir/$output_name" << BATCH_EOF
@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "BUNDLE_DIR=%SCRIPT_DIR%cli-bundle"
if not exist "%BUNDLE_DIR%\\node.exe" set "BUNDLE_DIR=%SCRIPT_DIR%..\\Resources\\cli-bundle"
"%BUNDLE_DIR%\\node.exe" "%BUNDLE_DIR%\\node_modules\\${cli_path}" %*
BATCH_EOF
    else
        # Unix shell launcher - searches multiple locations for bundle
        cat > "$output_dir/$output_name" << SHELL_EOF
#!/bin/bash
SCRIPT_DIR="\$(cd "\$(dirname "\$0")" && pwd)"

# Search for cli-bundle in multiple locations
# 1. Same directory as launcher (development / Linux)
# 2. ../Resources/cli-bundle (macOS app bundle)
# 3. Resources subdirectory
for DIR in "\$SCRIPT_DIR/cli-bundle" "\$SCRIPT_DIR/../Resources/cli-bundle" "\$SCRIPT_DIR/Resources/cli-bundle"; do
    if [ -f "\$DIR/node" ] && [ -d "\$DIR/node_modules" ]; then
        BUNDLE_DIR="\$DIR"
        break
    fi
done

if [ -z "\$BUNDLE_DIR" ]; then
    echo "Error: cli-bundle not found" >&2
    echo "Searched in:" >&2
    echo "  - \$SCRIPT_DIR/cli-bundle" >&2
    echo "  - \$SCRIPT_DIR/../Resources/cli-bundle" >&2
    exit 1
fi

exec "\$BUNDLE_DIR/node" "\$BUNDLE_DIR/node_modules/${cli_path}" "\$@"
SHELL_EOF
        chmod +x "$output_dir/$output_name"
    fi

    # Create target-specific launcher (Tauri adds target triple suffix to externalBin)
    local target_suffix=""
    case "$target" in
        x86_64-unknown-linux-gnu|x86_64-pc-windows-msvc|x86_64-apple-darwin|aarch64-apple-darwin)
            target_suffix="-$target"
            ;;
        current)
            local os_name=$(uname -s)
            local arch=$(uname -m)
            case "$os_name" in
                Darwin)
                    target_suffix=$([ "$arch" = "arm64" ] && echo "-aarch64-apple-darwin" || echo "-x86_64-apple-darwin")
                    ;;
                Linux)
                    target_suffix="-x86_64-unknown-linux-gnu"
                    ;;
            esac
            ;;
    esac

    if [ -n "$target_suffix" ]; then
        local target_launcher="$output_dir/${cli_name}${target_suffix}"
        if [ "$node_platform" = "win" ]; then
            target_launcher="$output_dir/${cli_name}${target_suffix}.cmd"
        fi
        cp "$output_dir/$output_name" "$target_launcher"
        chmod +x "$target_launcher" 2>/dev/null || true
        log_info "Created launcher: $target_launcher"
    fi
}

# Update tauri.conf.json to include CLI bundle sidecar (unified cli-bundle with both Claude and Codex)
update_tauri_config() {
    if [ "$BUNDLE_CLI" != "true" ]; then
        return 0
    fi

    log_info "Updating tauri.conf.json to include CLI bundle sidecar..."

    local config_file="$PROJECT_ROOT/src-tauri/tauri.conf.json"

    # Use node to properly update JSON config
    node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$config_file', 'utf8'));

// Ensure arrays exist
if (!config.bundle.externalBin) {
    config.bundle.externalBin = [];
}
if (!config.bundle.resources) {
    config.bundle.resources = [];
}

// Add unified CLI bundle (both Claude and Codex share one Node.js)
// Add launcher scripts for both CLIs
if (!config.bundle.externalBin.includes('../src-api/dist/claude')) {
    config.bundle.externalBin.unshift('../src-api/dist/claude');
}
if (!config.bundle.externalBin.includes('../src-api/dist/codex')) {
    config.bundle.externalBin.unshift('../src-api/dist/codex');
}

// Add cli-bundle as resource (contains shared Node.js + both CLI packages)
const cliResource = '../src-api/dist/cli-bundle/**/*';
if (!config.bundle.resources.includes(cliResource)) {
    // Remove old separate bundle resources
    config.bundle.resources = config.bundle.resources.filter(r =>
        !r.includes('claude-bundle') && !r.includes('codex-bundle')
    );
    config.bundle.resources.push(cliResource);
}
console.log('Added unified CLI bundle config');

fs.writeFileSync('$config_file', JSON.stringify(config, null, 2));
console.log('Config updated successfully');
"
    log_info "Updated tauri.conf.json with unified CLI bundle configuration"
}

# Update tauri.conf.json to disable signing
disable_signing_config() {
    if [ "$SKIP_SIGNING" != "true" ]; then
        return 0
    fi

    log_info "Disabling code signing in tauri.conf.json..."

    local config_file="$PROJECT_ROOT/src-tauri/tauri.conf.json"

    # Use node to remove signing config
    node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$config_file', 'utf8'));

// Remove macOS signing identity to disable signing
if (config.bundle && config.bundle.macOS) {
    delete config.bundle.macOS.signingIdentity;
}

fs.writeFileSync('$config_file', JSON.stringify(config, null, 2));
console.log('Signing disabled in config');
"
}

# Get version from tauri.conf.json
get_app_version() {
    node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$PROJECT_ROOT/src-tauri/tauri.conf.json', 'utf8'));
console.log(config.version || '0.0.0');
"
}

# Build for Linux (x86_64)
build_linux() {
    log_info "Building for Linux x86_64..."

    local target="x86_64-unknown-linux-gnu"

    # Build API sidecar first
    build_api_sidecar "$target"

    # Bundle CLI tools if requested (unified bundle with both Claude and Codex)
    bundle_cli_tools "$target"
    update_tauri_config

    # Add target if not exists
    rustup target add "$target" 2>/dev/null || true

    pnpm tauri build --target "$target"

    # Config restore removed - no longer needed

    log_info "Linux build completed!"
    log_info "Output: src-tauri/target/$target/release/bundle/"
}

# Build for Windows (x86_64)
build_windows() {
    log_info "Building for Windows x86_64..."

    local target="x86_64-pc-windows-msvc"

    # Build API sidecar first
    build_api_sidecar "$target"

    # Bundle CLI tools if requested (unified bundle with both Claude and Codex)
    bundle_cli_tools "$target"
    update_tauri_config

    # Add target if not exists
    rustup target add "$target" 2>/dev/null || true

    pnpm tauri build --target "$target"

    # Config restore removed - no longer needed

    log_info "Windows build completed!"
    log_info "Output: src-tauri/target/$target/release/bundle/"
}

# Build for macOS Intel (x86_64)
build_mac_intel() {
    log_info "Building for macOS Intel (x86_64)..."

    local target="x86_64-apple-darwin"

    # Build API sidecar first
    build_api_sidecar "$target"

    # Bundle CLI tools if requested (unified bundle with both Claude and Codex)
    bundle_cli_tools "$target"
    update_tauri_config

    # Add target if not exists
    rustup target add "$target" 2>/dev/null || true

    pnpm tauri build --target "$target"

    # Copy cli-bundle to app bundle (after Tauri build)
    copy_cli_bundle_to_app "$target"

    # Recreate DMG with bundle included
    recreate_dmg "$target"

    # Config restore removed - no longer needed

    log_info "macOS Intel build completed!"
    log_info "Output: src-tauri/target/$target/release/bundle/"
}

# Copy cli-bundle to app bundle after Tauri build (unified bundle with both Claude and Codex)
copy_cli_bundle_to_app() {
    local target="$1"

    if [ "$BUNDLE_CLI" != "true" ]; then
        return 0
    fi

    log_info "Copying cli-bundle to app bundle..."

    local app_path=""
    case "$target" in
        aarch64-apple-darwin|x86_64-apple-darwin)
            app_path="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/macos/WorkAny.app/Contents/MacOS"
            ;;
        current)
            # Try to find the app
            app_path="$PROJECT_ROOT/src-tauri/target/release/bundle/macos/WorkAny.app/Contents/MacOS"
            if [ ! -d "$app_path" ]; then
                # Try with arch
                local arch=$(uname -m)
                if [ "$arch" = "arm64" ]; then
                    app_path="$PROJECT_ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/WorkAny.app/Contents/MacOS"
                else
                    app_path="$PROJECT_ROOT/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/WorkAny.app/Contents/MacOS"
                fi
            fi
            ;;
        *)
            log_warn "Platform $target may not need bundle copy"
            return 0
            ;;
    esac

    local bundle_src="$PROJECT_ROOT/src-api/dist/cli-bundle"

    if [ ! -d "$bundle_src" ]; then
        log_error "cli-bundle not found at $bundle_src"
        return 1
    fi

    if [ ! -d "$app_path" ]; then
        log_warn "App bundle not found at $app_path"
        return 0
    fi

    # Copy cli-bundle to app bundle
    cp -r "$bundle_src" "$app_path/"
    log_info "Copied cli-bundle to $app_path/"

    # Copy launcher scripts for both CLIs
    for cli in claude codex; do
        local launcher_src="$PROJECT_ROOT/src-api/dist/$cli"
        if [ -f "$launcher_src" ]; then
            cp "$launcher_src" "$app_path/$cli"
            chmod +x "$app_path/$cli"
            log_info "Copied $cli launcher script to $app_path/"
        fi
    done

    # Verify
    if [ -f "$app_path/cli-bundle/node" ]; then
        log_info "cli-bundle successfully copied to app bundle"
    else
        log_error "Failed to copy cli-bundle"
        return 1
    fi

    # Re-sign the entire app bundle after adding cli-bundle
    # This is required because adding files invalidates the signature
    if [ "$SKIP_SIGNING" != "true" ]; then
        log_info "Re-signing app bundle after adding cli-bundle..."

        local app_bundle=""
        case "$target" in
            aarch64-apple-darwin|x86_64-apple-darwin)
                app_bundle="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/macos/WorkAny.app"
                ;;
            current)
                local arch=$(uname -m)
                if [ "$arch" = "arm64" ]; then
                    app_bundle="$PROJECT_ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/WorkAny.app"
                else
                    app_bundle="$PROJECT_ROOT/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/WorkAny.app"
                fi
                ;;
        esac

        if [ -d "$app_bundle" ]; then
            local signing_identity="${APPLE_SIGNING_IDENTITY:-Developer ID Application}"
            local entitlements="$PROJECT_ROOT/src-tauri/entitlements.plist"

            # Sign all Mach-O binaries in cli-bundle first
            log_info "  Signing cli-bundle binaries..."
            find "$app_bundle/Contents/MacOS/cli-bundle" -type f 2>/dev/null | while read -r file; do
                if file "$file" 2>/dev/null | grep -q "Mach-O"; then
                    codesign --force --timestamp --options runtime --sign "$signing_identity" "$file" 2>&1 || true
                fi
            done

            # Re-sign the entire app bundle with entitlements
            log_info "  Re-signing entire app bundle..."
            codesign --force --deep --timestamp --options runtime \
                --entitlements "$entitlements" \
                --sign "$signing_identity" "$app_bundle"

            log_info "App bundle re-signed successfully"
        fi
    fi
}

# Recreate DMG after modifying app bundle
recreate_dmg() {
    local target="$1"

    if [ "$BUNDLE_CLI" != "true" ]; then
        return 0
    fi

    log_info "Recreating DMG with cli-bundle included..."

    local app_path=""
    local dmg_dir=""
    local dmg_name=""
    local version=$(get_app_version)

    case "$target" in
        aarch64-apple-darwin)
            app_path="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/macos/WorkAny.app"
            dmg_dir="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/dmg"
            dmg_name="WorkAny_${version}_aarch64.dmg"
            ;;
        x86_64-apple-darwin)
            app_path="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/macos/WorkAny.app"
            dmg_dir="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/dmg"
            dmg_name="WorkAny_${version}_x64.dmg"
            ;;
        *)
            log_warn "DMG recreation not needed for $target"
            return 0
            ;;
    esac

    if [ ! -d "$app_path" ]; then
        log_warn "App bundle not found at $app_path"
        return 0
    fi

    # Remove old DMG and create new one
    rm -f "$dmg_dir"/*.dmg
    mkdir -p "$dmg_dir"

    # Create temp directory with app and Applications shortcut
    local temp_dir=$(mktemp -d)
    cp -R "$app_path" "$temp_dir/"
    ln -s /Applications "$temp_dir/Applications"

    # Hide .app extension in Finder
    SetFile -a E "$temp_dir/WorkAny.app" 2>/dev/null || true

    log_info "Creating DMG with Applications shortcut..."
    hdiutil create -volname WorkAny -srcfolder "$temp_dir" -ov -format UDZO "$dmg_dir/$dmg_name"

    # Clean up temp directory
    rm -rf "$temp_dir"

    if [ -f "$dmg_dir/$dmg_name" ]; then
        local dmg_size=$(du -h "$dmg_dir/$dmg_name" | cut -f1)
        log_info "DMG recreated: $dmg_dir/$dmg_name ($dmg_size)"
    else
        log_error "Failed to recreate DMG"
        return 1
    fi
}

# Build for macOS Apple Silicon (aarch64)
build_mac_arm() {
    log_info "Building for macOS Apple Silicon (aarch64)..."

    local target="aarch64-apple-darwin"

    # Build API sidecar first
    build_api_sidecar "$target"

    # Bundle CLI tools if requested (unified bundle with both Claude and Codex)
    bundle_cli_tools "$target"
    update_tauri_config

    # Add target if not exists
    rustup target add "$target" 2>/dev/null || true

    pnpm tauri build --target "$target"

    # Copy cli-bundle to app bundle (after Tauri build)
    copy_cli_bundle_to_app "$target"

    # Recreate DMG with bundle included
    recreate_dmg "$target"

    # Config restore removed - no longer needed

    log_info "macOS Apple Silicon build completed!"
    log_info "Output: src-tauri/target/$target/release/bundle/"
}

# Build for current platform
build_current() {
    log_info "Building for current platform..."

    # Build API sidecar first
    build_api_sidecar "current"

    # Bundle CLI tools if requested (unified bundle with both Claude and Codex)
    bundle_cli_tools "current"
    update_tauri_config

    pnpm tauri build

    # Copy cli-bundle to app bundle
    copy_cli_bundle_to_app "current"

    # Config restore removed - no longer needed

    log_info "Build completed!"
    log_info "Output: src-tauri/target/release/bundle/"
}


# Show help
show_help() {
    echo "WorkAny Build Script"
    echo ""
    echo "Usage: ./scripts/build.sh [platform] [options]"
    echo ""
    echo "Platforms:"
    echo "  linux       - Build for Linux x86_64"
    echo "  windows     - Build for Windows x86_64"
    echo "  mac-intel   - Build for macOS Intel (x86_64) ~30MB"
    echo "  mac-arm     - Build for macOS Apple Silicon (aarch64) ~27MB"
    echo "  current     - Build for current platform (default)"
    echo "  all         - Build for all platforms (requires cross-compilation setup)"
    echo ""
    echo "Options:"
    echo "  --with-cli      Bundle CLI tools (Claude Code + Codex) with shared Node.js"
    echo "                  This creates a unified bundle (~100MB) containing:"
    echo "                  - One Node.js binary (shared)"
    echo "                  - @anthropic-ai/claude-code"
    echo "                  - @openai/codex"
    echo "                  Allows out-of-box Claude Code and Codex sandbox support"
    echo "  --sign          Enable code signing and notarization (macOS)"
    echo "                  Default: signing is DISABLED for faster builds"
    echo "  --no-sign       Explicitly disable signing (default behavior)"
    echo ""
    echo "Requirements:"
    echo "  - pnpm"
    echo "  - Node.js (for API sidecar)"
    echo "  - Rust (cargo, rustup)"
    echo ""
    echo "Examples:"
    echo "  ./scripts/build.sh                     # Build for current platform (no signing)"
    echo "  ./scripts/build.sh mac-arm             # Build for Apple Silicon (fast, no signing)"
    echo "  ./scripts/build.sh mac-arm --with-cli  # Build with bundled CLI tools"
    echo "  ./scripts/build.sh mac-arm --sign      # Build with signing and notarization"
    echo "  ./scripts/build.sh mac-arm --with-cli --sign  # Full release build"
    echo ""
    echo "Note: Cross-compilation requires proper toolchain setup."
    echo "      For CI/CD builds, use GitHub Actions workflow instead."
    echo ""
    echo "CLI bundling (--with-cli):"
    echo "  Creates a unified cli-bundle with one shared Node.js binary and both CLIs:"
    echo "  - Claude Code CLI: for AI-assisted coding"
    echo "  - Codex CLI: for sandbox execution (macOS/Linux)"
    echo "  This saves ~80MB compared to bundling each CLI separately."
}

# Parse arguments and set global variables
# Sets: BUNDLE_CLI, BUILD_PLATFORM, SKIP_SIGNING
parse_args() {
    BUILD_PLATFORM="current"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --with-cli)
                BUNDLE_CLI=true
                shift
                ;;
            # Keep legacy flags for backwards compatibility
            --with-claude|--with-codex)
                BUNDLE_CLI=true
                log_warn "Note: --with-claude and --with-codex are deprecated. Use --with-cli instead (bundles both)."
                shift
                ;;
            --sign)
                SKIP_SIGNING=false
                shift
                ;;
            --no-sign)
                SKIP_SIGNING=true
                shift
                ;;
            -h|--help|help)
                show_help
                exit 0
                ;;
            linux|windows|mac-intel|mac-arm|current|all)
                BUILD_PLATFORM="$1"
                shift
                ;;
            *)
                log_error "Unknown argument: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

# Main
main() {
    # Parse arguments first (sets BUILD_PLATFORM, BUNDLE_CLI, SKIP_SIGNING)
    parse_args "$@"

    if [ "$BUNDLE_CLI" = "true" ]; then
        log_info "CLI bundling enabled (Claude Code + Codex with shared Node.js)"
    fi

    if [ "$SKIP_SIGNING" = "true" ]; then
        log_info "Code signing disabled (use --sign to enable)"
        # Use ad-hoc signing (no certificate required, faster)
        export APPLE_SIGNING_IDENTITY="-"
        # Disable notarization
        export TAURI_SKIP_NOTARIZATION=true
        # Also set these to ensure no signing attempt
        unset APPLE_CERTIFICATE
        unset APPLE_CERTIFICATE_PASSWORD
        unset APPLE_ID
        unset APPLE_PASSWORD
        unset APPLE_TEAM_ID
        # Also modify config file to remove signing identity
        disable_signing_config
    else
        log_info "Code signing enabled"
    fi

    local platform="$BUILD_PLATFORM"

    check_requirements
    install_deps

    case "$platform" in
        linux)
            build_linux
            ;;
        windows)
            build_windows
            ;;
        mac-intel)
            build_mac_intel
            ;;
        mac-arm)
            build_mac_arm
            ;;
        current)
            build_current
            ;;
        all)
            log_warn "Building for all platforms requires cross-compilation setup."
            log_warn "Consider using GitHub Actions for cross-platform builds."
            build_linux
            build_windows
            build_mac_intel
            build_mac_arm
            ;;
    esac

    # Summary
    if [ "$BUNDLE_CLI" = "true" ]; then
        log_info "Build completed with bundled CLI tools (Claude Code + Codex)"
    else
        log_info "Build completed (no CLI tools bundled)"
    fi
}

main "$@"
