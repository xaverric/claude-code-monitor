#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/ClaudeCodeMonitor.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"

mkdir -p "$MACOS" "$RESOURCES"
cp "$DIR/ClaudeCodeMonitor/Info.plist" "$CONTENTS/"

# Generate app icon
echo "Generating app icon..."
ICON_GEN="$DIR/.generate-icon"
if swiftc -O "$DIR/ClaudeCodeMonitor/generate-icon.swift" -o "$ICON_GEN" -framework Cocoa 2>&1; then
  "$ICON_GEN" "$RESOURCES"
  if iconutil -c icns "$RESOURCES/AppIcon.iconset" -o "$RESOURCES/AppIcon.icns" 2>&1; then
    echo "App icon created"
  fi
  rm -rf "$RESOURCES/AppIcon.iconset" "$ICON_GEN"
else
  echo "Icon generation skipped (non-fatal)"
  rm -f "$ICON_GEN"
fi

# Build app binary
echo "Compiling app..."
swiftc -O \
  "$DIR/ClaudeCodeMonitor/main.swift" \
  "$DIR/ClaudeCodeMonitor/StatusBarController.swift" \
  "$DIR/ClaudeCodeMonitor/DaemonManager.swift" \
  "$DIR/ClaudeCodeMonitor/SettingsWindow.swift" \
  -o "$MACOS/ClaudeCodeMonitor" \
  -framework Cocoa

if [ $? -eq 0 ]; then
  echo "Built: $APP"
else
  echo "Build failed" >&2
  exit 1
fi
