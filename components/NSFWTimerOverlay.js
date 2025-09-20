/**
 * NSFW Timer Overlay Component
 * Shows progress bar and timer for NSFW message viewing
 */

import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, Animated } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors } from '../constants/Design'

const NSFWTimerOverlay = ({ 
  isVisible = false,
  progress = 0,
  timeRemaining = 0,
  mediaType = 'photo',
  onComplete = null,
  style = {}
}) => {
  const [animatedProgress] = useState(new Animated.Value(0))
  const [pulseAnim] = useState(new Animated.Value(1))

  // Animate progress bar
  useEffect(() => {
    Animated.timing(animatedProgress, {
      toValue: progress,
      duration: 100,
      useNativeDriver: false
    }).start()
  }, [progress])

  // Pulse animation for timer icon
  useEffect(() => {
    if (isVisible) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 500,
            useNativeDriver: true
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true
          })
        ])
      )
      pulse.start()
      
      return () => pulse.stop()
    }
  }, [isVisible])

  // Format remaining time
  const formatTime = (seconds) => {
    if (seconds < 1) return '0s'
    return `${Math.ceil(seconds)}s`
  }

  if (!isVisible) return null

  return (
    <View style={[styles.container, style]}>
      {/* Background overlay */}
      <View style={styles.background} />
      
      {/* Content */}
      <View style={styles.content}>
        {/* Icon and label */}
        <View style={styles.header}>
          <Animated.View style={[styles.iconContainer, { transform: [{ scale: pulseAnim }] }]}>
            <Ionicons 
              name="flame" 
              size={20} 
              color={Colors.fire || '#FF6B6B'} 
            />
          </Animated.View>
          <Text style={styles.label}>
            {mediaType === 'video' ? 'Playing...' : 'Viewing...'}
          </Text>
          <Text style={styles.timer}>
            {formatTime(timeRemaining)}
          </Text>
        </View>

        {/* Progress bar */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBackground} />
          <Animated.View 
            style={[
              styles.progressBar,
              {
                width: animatedProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                  extrapolate: 'clamp'
                })
              }
            ]} 
          />
        </View>

        {/* Warning text */}
        <Text style={styles.warning}>
          Message will disappear after viewing
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    pointerEvents: 'none'
  },
  background: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 80, // Reduced from 120
    backgroundColor: 'rgba(0, 0, 0, 0.6)', // More transparent
    borderBottomLeftRadius: 12, // Smaller radius
    borderBottomRightRadius: 12
  },
  content: {
    padding: 12, // Reduced padding
    paddingTop: 16
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8 // Reduced margin
  },
  iconContainer: {
    width: 24, // Smaller icon
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 107, 107, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8 // Reduced margin
  },
  label: {
    fontSize: 14, // Smaller font
    fontWeight: '600',
    color: Colors.white,
    flex: 1
  },
  timer: {
    fontSize: 14, // Smaller font
    fontWeight: '700',
    color: Colors.fire || '#FF6B6B',
    minWidth: 25,
    textAlign: 'right'
  },
  progressContainer: {
    height: 3, // Thinner progress bar
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 1.5,
    overflow: 'hidden',
    marginBottom: 6 // Reduced margin
  },
  progressBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.1)'
  },
  progressBar: {
    height: '100%',
    backgroundColor: Colors.fire || '#FF6B6B',
    borderRadius: 1.5
  },
  warning: {
    fontSize: 10, // Smaller warning text
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    fontStyle: 'italic'
  }
})

export default NSFWTimerOverlay
