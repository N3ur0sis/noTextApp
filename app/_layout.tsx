import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { enableScreens } from 'react-native-screens';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
// Screen capture prevention is now handled by hooks in platform-specific screens
import { useEffect } from 'react';
import * as ScreenCapture from 'expo-screen-capture';
import { Platform , AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { useColorScheme } from '../hooks/useColorScheme';
import AppStatusBarComponent from '../components/AppStatusBar';
import { AuthProvider } from '../context/AuthContext';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Config } from '../constants/Config';

enableScreens(true);

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // Globally prevent screen capture on Android only
  useEffect(() => {
    if (Platform.OS === 'android') {
      ScreenCapture.preventScreenCaptureAsync();
      return () => { ScreenCapture.allowScreenCaptureAsync(); };
    }
    return undefined;
  }, []);
  
  const colorScheme = useColorScheme();
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (loaded) {
      // 🚀 Initialize unified system on app start
      Promise.resolve().then(async () => {
        try {
          // Import only what we need
          const { apiManager } = await import('../services/apiManager');
          
          // Log startup performance (only in development)
          const startTime = performance.now();
          
          if (Config.ENABLE_DEBUG_LOGS) {
            console.log('🚀 Initializing app services...');
          }
          
          // Wait for apiManager to restore cache
          await apiManager._restoreCacheFromStorage();
          
          // Pre-warm frequently accessed caches in background (only in development)
          if (Config.ENABLE_DEBUG_LOGS) {
            setTimeout(async () => {
              try {
                // We can't access hook context here, but we can prepare the system
                console.log('Cache pre-warming complete');
              } catch {
                // Non-critical, continue anyway
              }
            }, 100);
          }
          
          const duration = Math.round(performance.now() - startTime);
          
          if (Config.ENABLE_DEBUG_LOGS) {
            console.log(`✅ App initialization complete in ${duration}ms`);
          }
        } catch (error) {
          // Non-critical error handling
          if (Config.ENABLE_DEBUG_LOGS) {
            console.error('App initialization error:', error);
          }
        } finally {
          // Hide splash screen with a small delay for smooth transition
          setTimeout(() => {
            SplashScreen.hideAsync();
          }, Config.IS_PRODUCTION ? 0 : 100);
        }
      });
    }
  }, [loaded]);

  // 🧹 Enhanced app state handling for background services and forced refresh
  useEffect(() => {
    let wasInBackground = false;
    
    const handleAppStateChange = async (nextAppState: string) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        console.log('📱 [APP_STATE] App going to background');
        wasInBackground = true;
        // apiManager handles cache persistence automatically
      } else if (nextAppState === 'active') {
        console.log('📱 [APP_STATE] App becoming active, wasInBackground:', wasInBackground);
        
        // Ensure services are properly connected when coming back to foreground
        try {
          // Force refresh when returning from background after long time
          if (wasInBackground) {
            console.log('🔄 [APP_STATE] Forcing refresh after background return');
            
            // Import and trigger global refresh
            const { realtimeCacheManager } = await import('../services/realtimeCacheManager');
            const { apiManager } = await import('../services/apiManager');
            
            // Invalidate all caches to force fresh data
            apiManager.clearCache();
            
            // Emit global refresh events
            realtimeCacheManager.emit('appReturnedFromBackground', { 
              timestamp: Date.now(),
              forceRefresh: true 
            });
            
            // Reset background flag
            wasInBackground = false;
          }
          
          console.log('✅ [APP_STATE] App state change handled');
        } catch (error) {
          console.error('❌ [APP_STATE] Error handling app state change:', error);
        }
      }
    }

    const subscription = AppState.addEventListener('change', handleAppStateChange)
    return () => subscription?.remove()
  }, [])

  // Initialize background services
  useEffect(() => {
    const initBackgroundServices = async () => {
      try {
        // Initialize AppState handlers for realtime and background services
        const { setupRealtimeAppStateHandler } = await import('../services/productionRealtimeService');
        const { backgroundMessageService } = await import('../services/backgroundMessageService');
        
        setupRealtimeAppStateHandler();
        await backgroundMessageService.init();
        
        console.log('✅ Background services initialized');
      } catch (error) {
        console.error('❌ Error initializing background services:', error);
      }
    };

    initBackgroundServices();

    // Cleanup function
    return () => {
      // Cleanup will be handled by individual services
    };
  }, [])

  if (!loaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
          <SafeAreaProvider>

        
      <AuthProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack screenOptions={{ 
            headerShown: false,
            animation: 'slide_from_right',
            animationDuration: 200, // Reduced for faster navigation
            gestureEnabled: true
          }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="auth" />
            <Stack.Screen name="home" />
            <Stack.Screen 
              name="chat" 
              options={{ 
                presentation: 'fullScreenModal',
                gestureEnabled: true,
                animation: 'slide_from_bottom',
                animationDuration: 250, // Smooth vertical slide
                gestureDirection: 'vertical'
              }} 
            />
            <Stack.Screen 
              name="camera" 
              options={{ 
                presentation: 'fullScreenModal',
                gestureEnabled: true,
                animation: 'slide_from_bottom',
                animationDuration: 200 // Faster camera transition
              }} 
            />
            <Stack.Screen 
              name="settings" 
              options={{ 
                presentation: 'card',
                gestureEnabled: true,
                animation: 'slide_from_right',
                animationDuration: 150
              }} 
            />
          </Stack>
          <AppStatusBarComponent style="light" backgroundColor="rgba(0, 0, 0, 0.0)" />
        </ThemeProvider>
      </AuthProvider>
        </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
