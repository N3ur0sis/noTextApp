import { Dimensions, Platform, StatusBar } from 'react-native'

const { width, height } = Dimensions.get('window')

// Get Android status bar height safely
const getAndroidStatusBarHeight = () => {
  if (Platform.OS === 'android') {
    return StatusBar.currentHeight || 24
  }
  return 0
}

// Get responsive safe area top padding
export const getSafeAreaTop = () => {
  if (Platform.OS === 'ios') {
    return 60 // iOS has consistent safe area with notch handling
  }
  
  // Android: Account for status bar + reasonable padding
  const statusBarHeight = getAndroidStatusBarHeight()
  return statusBarHeight + 16 // Status bar + 16px padding
}

// Get responsive header height
export const getHeaderHeight = () => {
  return getSafeAreaTop() + 44 // Safe area + header content height
}

// Get responsive screen dimensions for percentage calculations
export const getResponsiveDimensions = () => {
  // Android devices vary more in aspect ratio, so use more conservative percentages
  const isAndroid = Platform.OS === 'android'
  
  return {
    width,
    height,
    // Responsive percentages that work better on Android
    safeHeight: height - getSafeAreaTop() - (isAndroid ? 48 : 34), // Account for navigation bars
    contentHeight: height * (isAndroid ? 0.75 : 0.8), // More conservative on Android
    formHeight: height * (isAndroid ? 0.35 : 0.4), // Smaller forms on Android
    headerTopPadding: getSafeAreaTop(),
  }
}

// Get responsive padding for scroll content
export const getScrollContentPadding = () => {
  const { headerTopPadding, safeHeight } = getResponsiveDimensions()
  
  return {
    paddingTop: Platform.OS === 'android' 
      ? headerTopPadding + 24 // More space on Android for better UX
      : headerTopPadding + 32, // Original iOS spacing
    paddingBottom: Platform.OS === 'android' ? 24 : 34, // Account for navigation bar differences
  }
}

// Get responsive keyboard avoiding behavior
export const getKeyboardAvoidingProps = () => {
  return {
    behavior: Platform.OS === 'ios' ? 'padding' : 'height',
    keyboardVerticalOffset: Platform.OS === 'ios' ? 0 : getSafeAreaTop() - 10, // Slight adjustment for Android
    enabled: true, // Ensure keyboard avoidance is enabled
  }
}

// Get responsive input sizing
export const getResponsiveInputHeight = () => {
  return Platform.OS === 'android' ? 52 : 50 // Slightly taller on Android for better touch targets
}

// Get responsive button sizing
export const getResponsiveButtonHeight = () => {
  return Platform.OS === 'android' ? 54 : 50 // Taller buttons on Android
}

// Get responsive spacing for different screen sizes
export const getResponsiveSpacing = () => {
  const screenRatio = height / width
  const isSmallScreen = height < 700 // Phones vs tablets
  const isAndroid = Platform.OS === 'android'
  
  return {
    screenPadding: isSmallScreen ? 20 : 24,
    sectionSpacing: isSmallScreen ? 24 : 32,
    inputSpacing: isSmallScreen ? (isAndroid ? 18 : 20) : (isAndroid ? 22 : 24), // Tighter spacing on Android small screens
    buttonSpacing: isSmallScreen ? 16 : 20,
  }
}

// Check if device has notch/safe area (iOS primarily)
export const hasNotch = () => {
  return Platform.OS === 'ios' && height >= 812 // iPhone X and newer
}

// Get responsive modal/overlay positioning
export const getModalPositioning = () => {
  const { headerTopPadding } = getResponsiveDimensions()
  
  return {
    top: headerTopPadding,
    paddingTop: Platform.OS === 'android' ? 16 : 20,
    maxHeight: Platform.OS === 'android' 
      ? height * 0.85 // Leave more space for Android system UI
      : height * 0.9,
  }
}

// Get Android-specific text scale adjustments
export const getTextScaling = () => {
  if (Platform.OS !== 'android') return 1
  
  // Account for Android's accessibility text scaling
  const isSmallScreen = height < 700
  return isSmallScreen ? 0.95 : 1 // Slightly smaller text on small Android screens
}

// Get Android-specific elevation for cards/buttons
export const getAndroidElevation = (level = 'medium') => {
  if (Platform.OS !== 'android') return {}
  
  const elevations = {
    low: { elevation: 2 },
    medium: { elevation: 4 },
    high: { elevation: 8 }
  }
  
  return elevations[level] || elevations.medium
}

export default {
  getSafeAreaTop,
  getHeaderHeight,
  getResponsiveDimensions,
  getScrollContentPadding,
  getKeyboardAvoidingProps,
  getResponsiveInputHeight,
  getResponsiveButtonHeight,
  getResponsiveSpacing,
  hasNotch,
  getModalPositioning,
  getTextScaling,
  getAndroidElevation,
}
