#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# EliaSubworkers — unified build script
# Usage: ./build-app.sh --device android|ios|all [--install] [--clean]
#   --device android  → APK release via Gradle (requires Android SDK)
#   --device ios      → IPA via Xcode (requires Xcode) or EAS cloud fallback
#   --device all      → both
#   --install         → adb install / open simulator after build
#   --clean           → npx expo prebuild --clean

ROOT="$(cd "$(dirname "$0")" && pwd)"
MOBILE="$ROOT/mobile"

DEVICE="android"
DO_INSTALL=false
DO_CLEAN=true

log()  { echo "[$(date '+%H:%M:%S')] $*" >&2; }
die()  { echo "[$(date '+%H:%M:%S')] ERROR $*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: $0 --device <android|ios|all> [--install] [--clean|--no-clean] [--help]

  --device android  Build Android APK (Gradle)
  --device ios      Build iOS IPA (Xcode or EAS cloud)
  --device all      Build both
  --install         Auto-install on connected device/emulator after build
  --clean           Run expo prebuild --clean (default)
  --no-clean        Skip prebuild, build native directly
  --help            Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device) DEVICE="${2:-}"; shift 2 ;;
    --install) DO_INSTALL=true; shift ;;
    --clean) DO_CLEAN=true; shift ;;
    --no-clean) DO_CLEAN=false; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown arg: $1 (see --help)" ;;
  esac
done

case "$DEVICE" in
  android|ios|all) ;;
  *) die "--device must be android, ios, or all" ;;
esac

command -v node >/dev/null 2>&1 || die "node required (nvm use 20)"
command -v npx >/dev/null 2>&1 || die "npx required"

# ── Android ────────────────────────────────────────────────────────────────
build_android() {
  log "→ Android build (device=$DEVICE, clean=$DO_CLEAN)"
  if [[ "$DO_CLEAN" == true ]]; then
    (cd "$MOBILE" && npx expo prebuild --platform android --clean)
  fi

  # Ensure SDK location
  ANDROID_SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  if [[ ! -d "$ANDROID_SDK" ]]; then
    die "Android SDK not found at $ANDROID_SDK — set ANDROID_HOME"
  fi
  echo "sdk.dir=$ANDROID_SDK" > "$MOBILE/android/local.properties"
  log "ANDROID_HOME=$ANDROID_SDK"

  (cd "$MOBILE/android" && ANDROID_HOME="$ANDROID_SDK" ./gradlew assembleRelease)

  APK="$MOBILE/android/app/build/outputs/apk/release/app-release.apk"
  [[ -f "$APK" ]] || die "APK not found at $APK"
  log "APK: $APK ($(du -h "$APK" | cut -f1))"

  if [[ "$DO_INSTALL" == true ]]; then
    if command -v adb >/dev/null 2>&1 && adb devices | grep -q "device$"; then
      log "Installing on device..."
      adb install -r "$APK"
    else
      log "No adb device — skipping install (connect phone via USB/Wi-Fi, enable USB debugging)"
    fi
  fi

  # Copy to root for release convenience
  cp "$APK" "$ROOT/EliaSubworkers-$(jq -r '.expo.version' "$MOBILE/app.json").apk" 2>/dev/null || cp "$APK" "$ROOT/EliaSubworkers.apk"
  log "APK copied to $ROOT"
}

# ── iOS ────────────────────────────────────────────────────────────────────
build_ios() {
  log "→ iOS build (clean=$DO_CLEAN)"
  if [[ "$DO_CLEAN" == true ]]; then
    (cd "$MOBILE" && npx expo prebuild --platform ios --clean)
  fi

  # Prefer local Xcode if available
  if command -v xcodebuild >/dev/null 2>&1 && xcode-select -p >/dev/null 2>&1; then
    log "Xcode found — building local archive..."
    # Ensure pods
    if command -v pod >/dev/null 2>&1; then
      (cd "$MOBILE/ios" && pod install) || log "pod install failed — continuing"
    else
      log "CocoaPods not found — brew install cocoapods if needed"
    fi
    SCHEME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$MOBILE/ios/EliaSubworkers/Info.plist" 2>/dev/null || echo "EliaSubworkers")"
    # Try to derive workspace
    WS="$MOBILE/ios/EliaSubworkers.xcworkspace"
    if [[ -d "$WS" ]]; then
      (cd "$MOBILE/ios" && xcodebuild -workspace "$(basename "$WS")" -scheme "$SCHEME" -configuration Release -sdk iphoneos -archivePath "$MOBILE/ios/build/Elia.xcarchive" archive) && \
      (cd "$MOBILE/ios" && xcodebuild -exportArchive -archivePath "$MOBILE/ios/build/Elia.xcarchive" -exportPath "$MOBILE/ios/build" -exportOptionsPlist ExportOptions.plist 2>/dev/null || log "Export failed — create ios/ExportOptions.plist for your team") && \
      log "IPA at $MOBILE/ios/build/*.ipa" || log "Xcode build failed — falling back to EAS"
    else
      log "Workspace not found — falling back to EAS"
      build_ios_eas
    fi
  else
    log "Xcode not found — using EAS cloud build"
    build_ios_eas
  fi

  if [[ "$DO_INSTALL" == true ]]; then
    log "For iOS, install via TestFlight / EAS internal distribution or drag .ipa to device"
  fi
}

build_ios_eas() {
  command -v eas >/dev/null 2>&1 || { log "eas CLI not found — npm i -g eas-cli"; return 1; }
  if [[ ! -f "$MOBILE/eas.json" ]]; then
    log "eas.json missing — running eas build:configure"
    (cd "$MOBILE" && eas build:configure --platform ios 2>&1 | tail -20)
  fi
  log "Starting EAS cloud build (preview)..."
  (cd "$MOBILE" && eas build --platform ios --profile preview --non-interactive) || die "EAS build failed — check https://expo.dev/accounts/$(eas whoami 2>/dev/null)/projects/elia-subworkers/builds"
}

# ── Dispatch ───────────────────────────────────────────────────────────────
case "$DEVICE" in
  android) build_android ;;
  ios) build_ios ;;
  all) build_android; build_ios ;;
esac

log "Done. Device=$DEVICE"
