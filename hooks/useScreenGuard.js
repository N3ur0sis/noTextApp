import * as ScreenCapture from 'expo-screen-capture';
import { useEffect } from 'react';
import { Platform } from 'react-native';

// Use this hook at a high level (e.g. HomeLayout) to block screen capture on Android only
export function useScreenGuard() {
  useEffect(() => {
    if (Platform.OS === 'android') {
      ScreenCapture.preventScreenCaptureAsync();
      return () => ScreenCapture.allowScreenCaptureAsync();
    }
  }, []);
}

// Use this hook on iOS screens that do NOT need TextInput (e.g. chat, sensitive info)
import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';

export function useScreenGuardOnThisScreen() {
  useFocusEffect(
    useCallback(() => {
      ScreenCapture.preventScreenCaptureAsync();
      return () => {
        ScreenCapture.allowScreenCaptureAsync();
      };
    }, [])
  );
}
