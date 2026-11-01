#!/usr/bin/env bash
# Builds a signed Tilawat.ipa with Xcode's automatic signing.
# Usage: TEAM_ID=XXXXXXXXXX [EXPORT_METHOD=debugging|release-testing|app-store-connect] scripts/build-ios.sh
# Needs Xcode with an Apple ID added (Xcode > Settings > Accounts). For on-device
# builds, connect the iPhone once so Xcode registers it.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${TEAM_ID:?Set TEAM_ID to your Apple developer team ID (Xcode > Settings > Accounts)}"
METHOD=${EXPORT_METHOD:-debugging}
OUT=build/ios

npm run assets
npm run build
npx cap sync ios

rm -rf "$OUT"
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/Tilawat.xcarchive" \
  -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic \
  archive

cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>$METHOD</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
</dict>
</plist>
PLIST

xcodebuild -exportArchive -archivePath "$OUT/Tilawat.xcarchive" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" -exportPath "$OUT" -allowProvisioningUpdates

ls -la "$OUT"/*.ipa
