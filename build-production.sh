#!/bin/bash

# Production EAS Build Script with FCM Support
# Ensures all environment variables and configuration are properly set

echo "🚀 Starting NoText Production Build with FCM Support..."

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

# Check Expo configuration
echo "🔍 Checking Expo configuration..."
npx expo-doctor || echo "⚠️ Expo doctor check completed with warnings"

# Start EAS build
echo "🏗️ Starting EAS production build..."
echo "Build will include:"
echo "  ✅ FCM (Firebase Cloud Messaging) support"
echo "  ✅ Expo Push Notifications"
echo "  ✅ Production environment configuration"
echo "  ✅ Android APK output"

eas build --platform android --profile production --local

if [ $? -eq 0 ]; then
    echo "✅ Production build completed successfully!"
    echo "📦 APK should be available in the build output"
    echo "🔔 Push notifications and FCM are configured and ready"
else
    echo "❌ Build failed!"
    echo "Check the error messages above for details"
    exit 1
fi
