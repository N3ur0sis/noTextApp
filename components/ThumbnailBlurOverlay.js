import React from 'react'
import { View, StyleSheet } from 'react-native'
import { BlurView } from 'expo-blur'
import { Ionicons } from '@expo/vector-icons'
import { Colors } from '../constants/Design'

/**
 * Simple blur overlay for home screen thumbnails
 * Unlike OneTimeBlurOverlay, this doesn't include built-in icons
 * Allows custom content to be displayed on top of the blur
 */
const ThumbnailBlurOverlay = ({ 
  visible = true, 
  intensity = 30, 
  style = {}, 
  children,
  showEyeIcon = false 
}) => {
  if (!visible) return null

  return (
    <View style={[StyleSheet.absoluteFill, style]}>
      <BlurView
        intensity={intensity}
        style={StyleSheet.absoluteFill}
        experimentalBlurMethod="dimezisBlurView"
      />
      <View style={styles.content}>
        {showEyeIcon && (
          <Ionicons 
            name="eye-off" 
            size={16} 
            color={Colors.white} 
          />
        )}
        {children}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
})

export default ThumbnailBlurOverlay
