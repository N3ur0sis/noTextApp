/**
 * One-Time View Blur Overlay
 * Platform-specific blur implementation for one-time messages
 */

import React from 'react'
import { Ionicons } from '@expo/vector-icons'
import { Platform, StyleSheet, View } from 'react-native'
import { Colors } from '../constants/Design'

// Try to import BlurView with fallback
let BlurView = null
try {
  const blurModule = require('expo-blur')
  BlurView = blurModule.BlurView
    } catch (_error) {
  console.warn('⚠️ [BLUR] expo-blur not available, using fallback overlay')
}

const OneTimeBlurOverlay = ({ 
  visible = false, 
  intensity = Platform.OS === 'ios' ? 50 : 50,
  style = {},
  children = null 
}) => {
  if (!visible) return null

  if (BlurView && Platform.OS === 'ios') {
    // Use Expo BlurView for iOS
    return (
      <BlurView
        intensity={intensity}
        style={[styles.overlay, style]}
        tint='dark'
      >
        <View style={styles.iconContainer}>
          <Ionicons 
            name="eye-off" 
            size={40} 
            color={Colors.white} 
            style={styles.icon}
          />
        </View>
        {children}
      </BlurView>
    )
  } else if (BlurView && Platform.OS === 'android') {
    // Use BlurView with experimental method for Android
    return (
      <BlurView
        intensity={intensity}
        style={[styles.overlay, style]}
        experimentalBlurMethod="dimezisBlurView"
        tint='dark'
      >
        <View style={styles.iconContainer}>
          <Ionicons 
            name="eye-off" 
            size={40} 
            color={Colors.white} 
            style={styles.icon}
          />
        </View>
        {children}
      </BlurView>
    )
  } else {
    // Fallback overlay when BlurView is not available
    return (
      <View style={[styles.overlay, styles.fallbackOverlay, style]}>
        <View style={styles.iconContainer}>
          <Ionicons 
            name="eye-off" 
            size={40} 
            color={Colors.white} 
            style={styles.icon}
          />
        </View>
        {children}
      </View>
    )
  }
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  fallbackOverlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.8)', // Dark semi-transparent overlay
  },
  iconContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 30,
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: {
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
})

export default OneTimeBlurOverlay
