#!/bin/bash

# Local Development APK Build Script with FCM Support
# Creates a development build locally with console logging enabled

echo "🚀 Starting NoText Local Development Build with FCM Support..."

# Set Android SDK environment variables
export ANDROID_HOME=~/Library/Android/sdk
export ANDROID_SDK_ROOT=~/Library/Android/sdk

# Verify Android SDK exists
if [ ! -d "$ANDROID_HOME" ]; then
    echo "❌ Android SDK not found at $ANDROID_HOME"
    echo "Please install Android Studio and SDK"
    exit 1
fi

echo "✅ Android SDK found at: $ANDROID_HOME"

# Verify Firebase configuration files exist in root (for CNG workflow)
if [ ! -f "google-services.json" ]; then
    echo "❌ google-services.json not found in root directory"
    exit 1
fi

if [ ! -f "GoogleService-Info.plist" ]; then
    echo "❌ GoogleService-Info.plist not found in root directory"
    exit 1
fi

echo "✅ All Firebase configuration files found"

# Verify dependencies
echo "🔍 Checking Firebase dependencies..."
if ! npm list @react-native-firebase/app @react-native-firebase/messaging &>/dev/null; then
    echo "❌ Firebase dependencies missing"
    echo "Installing Firebase dependencies..."
    npm install @react-native-firebase/app @react-native-firebase/messaging
fi

echo "✅ Firebase dependencies verified"

# Clean previous builds
echo "🧹 Cleaning previous builds..."
npx expo install --fix

# Prebuild for development
echo "🔨 Prebuilding for development..."
npx expo prebuild --platform android --clean

if [ $? -ne 0 ]; then
    echo "❌ Prebuild failed!"
    exit 1
fi

# Build development APK
echo "🏗️ Building development APK locally..."
cd android
./gradlew assembleDebug

if [ $? -eq 0 ]; then
    echo "✅ Development APK built successfully!"
    echo "� APK location: android/app/build/outputs/apk/debug/app-debug.apk"

    # Show APK info
    APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
    if [ -f "$APK_PATH" ]; then
        APK_SIZE=$(du -h "$APK_PATH" | cut -f1)
        echo "📊 APK size: $APK_SIZE"
        echo "📱 Install command: adb install -r $APK_PATH"
    fi

    echo ""
    echo "🔍 To see console logs after installing:"
    echo "   1. Connect device: adb devices"
    echo "   2. View logs: adb logcat | grep -i push"
    echo "   3. Or use: adb logcat | grep -i notext"

else
    echo "❌ Build failed!"
    exit 1
fi
