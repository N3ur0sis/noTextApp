/**
 * NSFW Tap-to-View Overlay Component
 * Shows a blurred overlay with "Tap to view" text for NSFW messages
 */

import React from 'react'
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native'
import { BlurView } from 'expo-blur'
import { Ionicons } from '@expo/vector-icons'
import { Colors } from '../constants/Design'

const NSFWTapToViewOverlay = ({ 
  isVisible = false,
  onTapToView = null,
  style = {}
}) => {
  if (!isVisible) return null

  return (
    <TouchableOpacity 
      style={[styles.container, style]}
      onPress={onTapToView}
      activeOpacity={0.8}
    >
      {/* High blur background */}
      <BlurView intensity={100} style={styles.blurBackground} />
      
      {/* Dark overlay for better contrast */}
      <View style={styles.darkOverlay} />
      
      {/* Content */}
      <View style={styles.content}>
        {/* NSFW Icon */}
        <View style={styles.iconContainer}>
          <Ionicons 
            name="flame" 
            size={32} 
            color={Colors.fire || '#FF6B6B'} 
          />
        </View>
        
        {/* Tap to view text */}
        <Text style={styles.tapText}>Tap to view</Text>
        
        {/* Warning text */}
        <Text style={styles.warningText}>
          This message will disappear after viewing
        </Text>
        
        {/* Visual indicator */}
        <View style={styles.tapIndicator}>
          <Ionicons 
            name="hand-left" 
            size={20} 
            color="rgba(255, 255, 255, 0.7)" 
          />
        </View>
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
    justifyContent: 'center',
    alignItems: 'center'
  },
  blurBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0
  },
  darkOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)'
  },
  content: {
    alignItems: 'center',
    padding: 32,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.3)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 107, 107, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16
  },
  tapText: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.white,
    marginBottom: 8,
    textAlign: 'center'
  },
  warningText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16
  },
  tapIndicator: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)'
  }
})

export default NSFWTapToViewOverlay
