#!/bin/bash

# Production APK Build Script
# Sets up environment and builds APK with proper configuration

echo "🚀 Building production APK for NoText..."

# Set Android SDK environment variables
export ANDROID_HOME=~/Library/Android/sdk
export ANDROID_SDK_ROOT=~/Library/Android/sdk

# Ensure Android SDK is accessible
if [ ! -d "$ANDROID_HOME" ]; then
    echo "❌ Android SDK not found at $ANDROID_HOME"
    echo "Please install Android Studio and SDK"
    exit 1
fi

echo "✅ Android SDK found at: $ANDROID_HOME"

# Clean and build
echo "🧹 Cleaning previous builds..."
cd android
./gradlew clean

echo "🔨 Building release APK..."
./gradlew assembleRelease

if [ $? -eq 0 ]; then
    echo "✅ APK built successfully!"
    echo "📦 APK location: android/app/build/outputs/apk/release/app-release.apk"
    
    # Show APK info
    APK_PATH="app/build/outputs/apk/release/app-release.apk"
    if [ -f "$APK_PATH" ]; then
        APK_SIZE=$(du -h "$APK_PATH" | cut -f1)
        echo "📊 APK size: $APK_SIZE"
    fi
else
    echo "❌ Build failed!"
    exit 1
fi
