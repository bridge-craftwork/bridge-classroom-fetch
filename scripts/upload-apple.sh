#!/usr/bin/env bash
#
# Archive the Safari apps and upload them to App Store Connect.
#
# USAGE
#   scripts/upload-apple.sh fetch [mac|ios|both]   # Bridge Classroom Fetch (default both)
#   scripts/upload-apple.sh dd                     # Bridge Craftwork DD, macOS only
#   scripts/upload-apple.sh ... --no-upload        # archive and export, stop before uploading
#
# Run scripts/package-stores.sh (or EXT=dd scripts/package-stores.sh) first: it
# refreshes the extension files inside the Xcode project, which is what gets
# archived. This script refuses a project carrying the screenshot build.
#
# Each run takes a fresh build number (yyyymmddHHMM), because App Store Connect
# rejects a build number it has seen, including from a failed upload. The
# marketing version (1.1.0) comes from the project.
#
# CREDENTIALS: the App Store Connect API key, from the login Keychain (synced
#   from 1Password by secrets-sync, family-computing/tools/secrets):
#   env/personal/ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_BASE64 (the .p8, base64).
#   The key is written to a private temporary folder for the run and deleted
#   afterwards. The same items ice-queue's release script reads.
#
# OUTPUT: dist/apple.noindex/ (.noindex: Spotlight skips it)
#
set -euo pipefail

# Xcode's packaging shells out to rsync and breaks with Homebrew's rsync 3.x.
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP="${1:-}"
PLATFORM="both"
UPLOAD=1
for arg in "${@:2}"; do
  case "$arg" in
    mac|ios|both) PLATFORM="$arg" ;;
    --no-upload) UPLOAD=0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

TEAM="8H3FX5B8KD"
DIST="dist/apple.noindex"
BUILD_NUMBER="${APPLE_BUILD:-$(date +%Y%m%d%H%M)}"

case "$APP" in
  fetch)
    PROJECT="safari/fetch/Bridge Classroom Fetch/Bridge Classroom Fetch.xcodeproj"
    RESOURCES="safari/fetch/Bridge Classroom Fetch/Shared (Extension)/Resources"
    ;;
  dd)
    PROJECT="safari/dd/Bridge Craftwork DD/Bridge Craftwork DD.xcodeproj"
    RESOURCES="safari/dd/Bridge Craftwork DD/Bridge Craftwork DD Extension/Resources"
    PLATFORM="mac"
    ;;
  *) sed -n '4,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac

# The same guard package-stores.sh applies to the store zips: the screenshot
# build redacts pages and must never ship, nor a test build's localhost.
if grep -qE 'localhost|127\.0\.0\.1|github\.io|redactContent' "$RESOURCES/manifest.json" ||
  grep -rqs 'shot-mode' "$RESOURCES"; then
  echo "$RESOURCES holds a screenshot or test build; rerun scripts/package-stores.sh" >&2
  exit 1
fi

keychain() {
  security find-generic-password -a "$USER" -s "env/personal/$1" -w 2>/dev/null ||
    { echo "Keychain item env/personal/$1 is missing; run secrets-sync" >&2; exit 1; }
}
ASC_KEY_ID="$(keychain ASC_KEY_ID)"
ASC_ISSUER_ID="$(keychain ASC_ISSUER_ID)"
KEY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bc-asc.XXXXXX")"
chmod 700 "$KEY_DIR"
trap 'rm -rf "$KEY_DIR"' EXIT
ASC_KEY_PATH="$KEY_DIR/AuthKey_$ASC_KEY_ID.p8"
(umask 077; keychain ASC_KEY_BASE64 | base64 -d > "$ASC_KEY_PATH")
# altool finds the key by its file name in this folder.
export API_PRIVATE_KEYS_DIR="$KEY_DIR"
AUTH=(-authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID" -authenticationKeyPath "$ASC_KEY_PATH")

mkdir -p "$DIST"
cat > "$DIST/ExportAppStore.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
EOF

release() { # $1 = mac|ios
  local scheme dest type key="$APP-$1"
  case "$APP-$1" in
    fetch-mac) scheme="Bridge Classroom Fetch (macOS)" ;;
    fetch-ios) scheme="Bridge Classroom Fetch (iOS)" ;;
    dd-mac) scheme="Bridge Craftwork DD" ;;
  esac
  case "$1" in
    mac) dest="generic/platform=macOS"; type="macos" ;;
    ios) dest="generic/platform=iOS"; type="ios" ;;
  esac

  local archive="$DIST/$key.xcarchive" out="$DIST/$key"
  echo "==> [$key] Archiving build $BUILD_NUMBER"
  rm -rf "$archive" "$out"
  xcodebuild archive -project "$PROJECT" -scheme "$scheme" -configuration Release \
    -destination "$dest" -archivePath "$archive" \
    CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
    -allowProvisioningUpdates "${AUTH[@]}" -quiet

  echo "==> [$key] Exporting for App Store Connect"
  xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$DIST/ExportAppStore.plist" \
    -exportPath "$out" -allowProvisioningUpdates "${AUTH[@]}" -quiet

  local pkg
  pkg="$(find "$out" -maxdepth 1 \( -name '*.ipa' -o -name '*.pkg' \) | head -1)"
  [ -n "$pkg" ] || { echo "[$key] export produced no .ipa or .pkg" >&2; exit 1; }
  if [ "$UPLOAD" = 0 ]; then
    echo "==> [$key] Built $pkg (not uploaded)"
    return
  fi
  echo "==> [$key] Uploading $(basename "$pkg")"
  xcrun altool --upload-app -f "$pkg" -t "$type" --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
}

case "$PLATFORM" in
  both) release mac; release ios ;;
  *) release "$PLATFORM" ;;
esac
echo "==> Done (build $BUILD_NUMBER)."
