import * as ScreenCapture from 'expo-screen-capture';
import { useFocusEffect } from 'expo-router';
import { Platform } from 'react-native';
import { useCallback } from 'react';

export function useChatScreenCaptureGuard() {
  console.log('🟢 [TRACE] useChatScreenCaptureGuard hook');
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'ios') {
        ScreenCapture.preventScreenCaptureAsync();
        return () => {
          ScreenCapture.allowScreenCaptureAsync();
        };
      }
      return undefined;
    }, [])
  );
}
