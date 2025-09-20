// Design System for NoText - Minimal Black & White Theme
import { Platform } from 'react-native'

export const Colors = {
  // Base colors
  black: '#000000',
  white: '#FFFFFF',
  
  // Grays
  gray900: '#0A0A0A',
  gray800: '#1A1A1A', 
  gray700: '#2A2A2A',
  gray600: '#404040',
  gray500: '#666666',
  gray400: '#999999',
  gray300: '#CCCCCC',
  gray200: '#E5E5E5',
  gray100: '#F5F5F5',
  
  // Transparent overlays
  blackOverlay: 'rgba(0, 0, 0, 0.3)',
  whiteOverlay: 'rgba(255, 255, 255, 0.1)',
  whiteOverlayLight: 'rgba(255, 255, 255, 0.05)',
  
  // Special
  fire: '#FF4444', // Only for 🔥 when absolutely needed  
  accent: '#007AFF', // iOS system blue for accents
  
  // Blur effects
  blurLight: 'rgba(255, 255, 255, 0.2)',
  blurMedium: 'rgba(0, 0, 0, 0.3)', 
  blurDark: 'rgba(0, 0, 0, 0.4)', // Balanced blur overlay
  blurHeavy: 'rgba(0, 0, 0, 0.5)', // Moderate strong blur overlay
  blurExtreme: 'rgba(0, 0, 0, 0.8)', // Strong but not black blur overlay
  glassEffect: 'rgba(255, 255, 255, 0.75)',
}

export const Typography = {
  // Font families
  primary: 'System', // Will use SF Pro on iOS, Roboto on Android
  
  // Font sizes - Reduced for Android
  xs: Platform.OS === 'android' ? 11 : 12,
  sm: Platform.OS === 'android' ? 13 : 14,
  base: Platform.OS === 'android' ? 15 : 16,
  lg: Platform.OS === 'android' ? 17 : 18,
  xl: Platform.OS === 'android' ? 19 : 20,
  xxl: Platform.OS === 'android' ? 22 : 24,
  xxxl: Platform.OS === 'android' ? 29 : 32,
  
  // Font weights
  thin: '100',
  extraLight: '200',
  light: '300',
  regular: '400',
  medium: '500',
  semiBold: '600',
  bold: '700',
}

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  screen: 24, // Default screen padding
}

export const BorderRadius = {
  sm: 8,
  base: 12,
  lg: 16,
  xl: 20,
  full: 9999,
}

export const Shadows = {
  subtle: {
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  medium: {
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
}

export const Layout = {
  // Touch targets
  touchTarget: 44,
  touchTargetLarge: 60,
  
  // Common sizes
  buttonHeight: 50,
  inputHeight: 44,
  headerHeight: 60,
  
  // Capture button
  captureButton: 80,
  captureButtonOuter: 100,
  
  // Responsive safe area padding
  safeAreaTop: {
    ios: 60,
    android: 45, // Lower padding for Android
  },
  
  // Android-specific adjustments
  androidStatusBarHeight: 24,
  androidNavigationBarHeight: 48,
}
