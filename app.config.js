export default {
  expo: {
    name: "NoText",
    slug: "noTextApp",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "notextapp",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    privacy: "unlisted",
    platforms: ["ios", "android"],
    splash: {
      image: "./assets/images/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#1a1a1a"
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: "com.notextapp.mobile",
      buildNumber: "1.0.0",
      googleServicesFile: "./GoogleService-Info.plist",
      infoPlist: {
        NSCameraUsageDescription: "NoText utilise votre caméra pour prendre des photos et enregistrer des vidéos directement dans l'interface de messagerie. Par exemple, lorsque vous appuyez sur le bouton caméra dans une conversation, vous pouvez capturer une photo ou une vidéo pour l'envoyer comme message à vos contacts. L'accès à la caméra n'est demandé que lorsque vous choisissez activement de prendre une photo ou une vidéo dans le chat.",
        NSMicrophoneUsageDescription: "NoText utilise votre microphone pour enregistrer l'audio lors de la création de messages vidéo. Par exemple, quand vous enregistrez une vidéo dans le chat pour l'envoyer à vos contacts, le microphone capture la partie audio de votre message vidéo. L'accès au microphone n'est demandé que pendant l'enregistrement actif de vidéos dans les conversations.",
        CFBundleAllowMixedLocalizations: true,
        ITSAppUsesNonExemptEncryption: false,
        UIViewControllerBasedStatusBarAppearance: false,
        // Age rating information
        "LSApplicationCategoryType": "public.app-category.social-networking",
        "RTCAppMetadata": {
          "ageRating": "18+",
          "contentDescriptors": ["USER_GENERATED_CONTENT"]
        }
      },
      entitlements: {
        "aps-environment": "production"
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#FFFFFF",
        monochromeImage: "./assets/images/adaptive-icon-monochrome.png"
      },
      package: "com.notextapp.mobile",
      compileSdkVersion: 34,
      targetSdkVersion: 34,
      minSdkVersion: 23,
      permissions: [
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.VIBRATE",
        "android.permission.WAKE_LOCK"
      ],
      edgeToEdgeEnabled: true,
      googleServicesFile: "./google-services.json",
      softwareKeyboardLayoutMode: "pan"
    },
    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/images/favicon.png"
    },
    plugins: [
      "expo-router",
      [
        "expo-camera",
        {
          cameraPermission: "NoText utilise votre caméra pour prendre des photos et enregistrer des vidéos directement dans l'interface de messagerie. Par exemple, lorsque vous appuyez sur le bouton caméra dans une conversation, vous pouvez capturer une photo ou une vidéo pour l'envoyer comme message à vos contacts.",
          microphonePermission: "NoText utilise votre microphone pour enregistrer l'audio lors de la création de messages vidéo. Par exemple, quand vous enregistrez une vidéo dans le chat pour l'envoyer à vos contacts, le microphone capture la partie audio de votre message vidéo.",
          recordAudioAndroid: true
        }
      ],
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#1a1a1a"
        }
      ],
      [
        "expo-notifications",
        {
          icon: "./assets/images/notification-icon.png",
          mode: "production",
          iosDisplayInForeground: true,
          androidMode: "default",
          androidCollapsedTitle: "#{unread_count} nouveaux messages"
        }
      ],
      [
        "@react-native-firebase/app",
        {
          android: {
            googleServicesFile: "./google-services.json"
          },
          ios: {
            googleServicesFile: "./GoogleService-Info.plist"
          }
        }
      ],
      "./plugins/firebase-notification-fix.js",
      [
        "expo-build-properties",
        {
          ios: {
            useFrameworks: "static",
            extraPods: [
              {
                name: "FirebaseCoreInternal",
                modular_headers: true
              },
              {
                name: "GoogleUtilities",
                modular_headers: true
              }
            ]
          }
        }
      ]
    ],
    experiments: {
      typedRoutes: true,
      // OPTIMIZATION: Enable experimental performance features
      reactCompiler: true
    },
    optimization: {
      // OPTIMIZATION: Bundle size optimizations
      bundleLoaderDictionary: true,
      treeShaking: true,
      minify: true
    },
    updates: {
      // EAS Update configuration
      url: "https://u.expo.dev/b4439451-f0d2-489c-9e7b-2fe3d242cf7e",
      enabled: false // Enable OTA updates for production builds
    },
    runtimeVersion: "1.0.0",
    extra: {
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
      expoProjectId: "b4439451-f0d2-489c-9e7b-2fe3d242cf7e", // Use EAS project ID consistently
      eas: {
        projectId: "b4439451-f0d2-489c-9e7b-2fe3d242cf7e"
      }
    }
  }
}
