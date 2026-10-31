#!/usr/bin/env bash
# Build the AVENZA AI Android app (android/build/avenza-ai.apk) with the Android SDK command-line tools only.
#
#   android/build.sh            build the APK
#   android/build.sh --install  build, install on the phone connected by USB, and link it to this computer
#
# Needs JDK 17+ and an Android SDK with platforms;android-35 and build-tools;35.0.0. Defaults to the copies in
# ~/.local/share/android (override with JAVA_HOME and ANDROID_HOME).
set -euo pipefail
cd "$(dirname "$0")"

TOOLS="${HOME}/.local/share/android"
export JAVA_HOME="${JAVA_HOME:-$TOOLS/jdk}"
SDK="${ANDROID_HOME:-$TOOLS/sdk}"
BT="$SDK/build-tools/35.0.0"
JAR="$SDK/platforms/android-35/android.jar"
ADB="$(command -v adb || echo "$TOOLS/platform-tools/adb")"
export PATH="$JAVA_HOME/bin:$PATH"
VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-1.0}"

[[ -x "$JAVA_HOME/bin/javac" ]] || { echo "JDK not found at $JAVA_HOME"; exit 1; }
[[ -f "$JAR" && -x "$BT/aapt2" ]] || { echo "Android SDK platform 35 / build-tools 35.0.0 not found under $SDK"; exit 1; }

rm -rf build && mkdir -p build/gen build/classes build/dex
echo "1/5 resources"
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/app.unaligned.apk -I "$JAR" --manifest AndroidManifest.xml -A assets build/res.zip \
  --java build/gen --min-sdk-version 24 --target-sdk-version 35 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME"
echo "2/5 java"
javac -nowarn -Xlint:-options -source 11 -target 11 -encoding UTF-8 -classpath "$JAR" -d build/classes \
  $(find src build/gen -name '*.java')
echo "3/5 dex"
"$BT/d8" --min-api 24 --release --lib "$JAR" --output build/dex $(find build/classes -name '*.class')
(cd build/dex && zip -q -j ../app.unaligned.apk classes.dex)
echo "4/5 align + sign"
"$BT/zipalign" -f -p 4 build/app.unaligned.apk build/app.aligned.apk
# A local debug key: fine for installing on your own phone over USB (not for the Play Store).
KEYSTORE="$TOOLS/avenza-debug.keystore"
[[ -f "$KEYSTORE" ]] || keytool -genkeypair -keystore "$KEYSTORE" -storepass android -keypass android -alias avenza \
  -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=AVENZA AI debug" >/dev/null 2>&1
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android --ks-key-alias avenza \
  --out build/avenza-ai.apk build/app.aligned.apk
"$BT/apksigner" verify build/avenza-ai.apk
echo "5/5 done: android/build/avenza-ai.apk ($(du -h build/avenza-ai.apk | cut -f1))"

if [[ "${1:-}" == "--install" ]]; then
  "$ADB" install -r build/avenza-ai.apk
  # The phone's localhost:3000 now reaches AVENZA on this computer, over the cable.
  "$ADB" reverse tcp:3000 tcp:3000
  "$ADB" shell am start -n ai.avenza.app/.MainActivity >/dev/null
  echo "Installed and opened AVENZA AI on the phone."
fi
