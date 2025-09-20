import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import { View, StyleSheet, ActivityIndicator, Text, TouchableOpacity, Platform } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import CachedVideo from './CachedVideo'
import { Colors, Typography, Spacing } from '../constants/Design'

/**
 * VideoPlayerWrapper - Enhanced video player with error handling and performance optimization
 * Features: Error states, loading indicators, retry functionality, platform-specific optimizations
 */
const VideoPlayerWrapper = memo(({
  source,
  style,
  shouldPlay = false,
  isLooping = false,
  isMuted = true,
  useNativeControls = false,
  autoPlay = false,
  mediaType = 'permanent',
  onLoad = null,
  onError = null,
  onPlaybackStatusUpdate = null,
  onDurationLoad = null, // New callback for when video duration is available
  onVideoEnd = null, // New callback for when video ends
  showControls = false,
  contentFit = 'cover',
  priority = 'normal'
}) => {
  // Debug: Log VideoPlayerWrapper instantiation
  if (__DEV__) {
    const sourceUri = typeof source === 'string' ? source : source?.uri
    const filename = sourceUri?.split('/').pop()?.split('?')[0] || 'unknown'
    console.log(`🎥 [VIDEO_WRAPPER] Component instantiated for: ${filename}`)
  }

  const [isLoading, setIsLoading] = useState(false) // Start with false - let CachedVideo handle loading
  const [error, setError] = useState(null)
  const [retryCount, setRetryCount] = useState(0)
  const [currentlyMuted, setCurrentlyMuted] = useState(isMuted)
  const playerRef = useRef(null)
  const maxRetries = 3

  // Enhanced error handling
  const handleError = useCallback((err) => {
    console.warn('🎥 [VIDEO_WRAPPER] Player error:', err)
    setError(err)
    setIsLoading(false)
    
    if (onError) {
      onError(err)
    }
  }, [onError])

  // Enhanced load handling
  const handleLoad = useCallback((player) => {
    console.log('🎥 [VIDEO_WRAPPER] Player loaded successfully')
    setIsLoading(false) // Clear any error states
    setError(null)
    playerRef.current = player
    
    // Set up status listener for duration and end detection
    if (player) {
      // Get duration when available with better error handling
      let durationFound = false
      
      const checkDuration = () => {
        try {
          // Check if player is still valid before accessing properties
          if (!player || typeof player.duration !== 'number') return
          
          if (player.duration > 0 && !durationFound && onDurationLoad) {
            console.log(`🎥 [VIDEO_WRAPPER] Video duration: ${player.duration}s`)
            durationFound = true
            onDurationLoad(player.duration)
            // Clear interval once duration is found
            if (player._durationInterval) {
              clearInterval(player._durationInterval)
              player._durationInterval = null
            }
          }
        } catch (_error) {
          // Player object became invalid, clear interval
          if (player._durationInterval) {
            clearInterval(player._durationInterval)
            player._durationInterval = null
          }
        }
      }
      
      // Check duration immediately and set up interval
      checkDuration()
      if (!durationFound) {
        const durationInterval = setInterval(checkDuration, 200)
        player._durationInterval = durationInterval
      }
      
      // Set up status update listener with proper error handling
      let hasEnded = false
      const statusUpdateInterval = setInterval(() => {
        try {
          // Check if player is still valid before accessing properties
          if (!player || typeof player.currentTime !== 'number' || typeof player.duration !== 'number') {
            return
          }
          
          const currentTime = player.currentTime
          const duration = player.duration
          
          if (duration > 0) {
            const isPlaying = !player.paused
            const didJustFinish = currentTime >= duration - 0.1 && duration > 0 // Small buffer for end detection
            
            const status = {
              currentTime,
              duration,
              isPlaying,
              didJustFinish
            }
            
            // Check if video ended (for non-looping videos) - only fire once
            if (didJustFinish && !isLooping && !hasEnded && onVideoEnd) {
              hasEnded = true
              console.log('🎥 [VIDEO_WRAPPER] Video ended')
              onVideoEnd()
              // Clear interval after video ends
              if (player._statusInterval) {
                clearInterval(player._statusInterval)
                player._statusInterval = null
              }
            }
            
            if (onPlaybackStatusUpdate) {
              onPlaybackStatusUpdate(status)
            }
          }
        } catch (_error) {
          // Player object became invalid, clear interval
          if (player._statusInterval) {
            clearInterval(player._statusInterval)
            player._statusInterval = null
          }
        }
      }, 500) // Reduced frequency to reduce errors
      
      // Store interval for cleanup
      player._statusInterval = statusUpdateInterval
    }
    
    if (onLoad) {
      onLoad(player)
    }
  }, [onLoad, onDurationLoad, onVideoEnd, isLooping, onPlaybackStatusUpdate])

  // Retry functionality
  const handleRetry = useCallback(() => {
    if (retryCount < maxRetries) {
      console.log(`🔄 [VIDEO_WRAPPER] Retrying video load (${retryCount + 1}/${maxRetries})`)
      setRetryCount(prev => prev + 1)
      setError(null)
      setIsLoading(true) // Show loading during retry
    }
  }, [retryCount, maxRetries])

  // Mute/unmute functionality
  const toggleMute = useCallback(() => {
    if (playerRef.current) {
      const newMutedState = !currentlyMuted
      playerRef.current.muted = newMutedState
      setCurrentlyMuted(newMutedState)
      if (__DEV__) {
        console.log(`🔊 [VIDEO_WRAPPER] Audio ${newMutedState ? 'muted' : 'unmuted'}`)
      }
    }
  }, [currentlyMuted])

  // Reset retry count when source changes
  useEffect(() => {
    setRetryCount(0)
    setError(null)
    setIsLoading(false) // Let CachedVideo handle its own loading
  }, [source])

  // Check for navigation state changes (for camera freezing fix)
  useEffect(() => {
    const checkNavigationState = () => {
      if (global._isNavigatingToCamera && playerRef.current) {
        try {
          console.log('🎥 [VIDEO_WRAPPER] Detected navigation to camera, pausing video immediately')
          playerRef.current.pause()
          
          // Clear intervals
          if (playerRef.current._durationInterval) {
            clearInterval(playerRef.current._durationInterval)
          }
          if (playerRef.current._statusInterval) {
            clearInterval(playerRef.current._statusInterval)
          }
        } catch (error) {
          console.warn('🎥 [VIDEO_WRAPPER] Error pausing for camera:', error)
        }
      }
    }
    
    // Check every 100ms if we're navigating to camera
    const intervalId = setInterval(checkNavigationState, 100)
    
    return () => {
      clearInterval(intervalId)
    }
  }, [])
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        try {
          // Clear intervals
          if (playerRef.current._durationInterval) {
            clearInterval(playerRef.current._durationInterval)
          }
          if (playerRef.current._statusInterval) {
            clearInterval(playerRef.current._statusInterval)
          }
          
          playerRef.current.pause()
          playerRef.current = null
        } catch (cleanupError) {
          console.warn('🎥 [VIDEO_WRAPPER] Cleanup error:', cleanupError)
        }
      }
    }
  }, [])

  // Loading state
  if (isLoading && !error) {
    if (__DEV__) {
      console.log(`🎥 [VIDEO_WRAPPER] Showing loading state for: ${typeof source === 'string' ? source?.split('/').pop() : source?.uri?.split('/').pop()}`)
    }
    return (
      <View style={[styles.container, style]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.white} />
          <Text style={styles.loadingText}>Chargement vidéo...</Text>
        </View>
      </View>
    )
  }

  // Error state with retry
  if (error && retryCount < maxRetries) {
    if (__DEV__) {
      console.log(`🎥 [VIDEO_WRAPPER] Showing error state (${retryCount}/${maxRetries})`)
    }
    return (
      <View style={[styles.container, style]}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.white} />
          <Text style={styles.errorText}>Erreur de lecture vidéo</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <Ionicons name="refresh" size={20} color={Colors.white} />
            <Text style={styles.retryText}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // Max retries reached
  if (error && retryCount >= maxRetries) {
    if (__DEV__) {
      console.log(`🎥 [VIDEO_WRAPPER] Max retries reached, showing final error`)
    }
    return (
      <View style={[styles.container, style]}>
        <View style={styles.errorContainer}>
          <Ionicons name="videocam-off" size={48} color={Colors.gray} />
          <Text style={styles.errorTextFinal}>Impossible de lire la vidéo</Text>
        </View>
      </View>
    )
  }

  // Main video player
  return (
    <View style={[styles.container, style]}>
      {/* Debug: Log VideoPlayerWrapper render */}
      {__DEV__ && console.log(`🎥 [VIDEO_WRAPPER] Rendering with source: ${typeof source === 'string' ? source?.split('/').pop() : source?.uri?.split('/').pop()}`)}
      
      <CachedVideo
        source={source}
        style={StyleSheet.absoluteFill}
        shouldPlay={shouldPlay}
        isLooping={isLooping}
        isMuted={currentlyMuted}
        useNativeControls={useNativeControls}
        autoPlay={autoPlay}
        mediaType={mediaType}
        onLoad={handleLoad}
        onError={handleError}
        onPlaybackStatusUpdate={onPlaybackStatusUpdate}
        onDurationLoad={onDurationLoad}
        onVideoEnd={onVideoEnd}
        priority={priority}
        contentFit={contentFit}
      />
      
      {/* Audio control - positioned at top-right, same height as media type indicator */}
      {showControls && (
        <View style={styles.audioControlOverlay}>
          <TouchableOpacity 
            style={styles.audioButton}
            onPress={toggleMute}
          >
            <Ionicons 
              name={currentlyMuted ? 'volume-mute' : 'volume-high'} 
              size={16} 
              color={Colors.white} 
            />
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.black,
    justifyContent: 'center',
    alignItems: 'center'
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl
  },
  loadingText: {
    color: Colors.white,
    fontSize: Typography.sm,
    marginTop: Spacing.md,
    textAlign: 'center'
  },
  errorContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl
  },
  errorText: {
    color: Colors.white,
    fontSize: Typography.base,
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
    textAlign: 'center'
  },
  errorTextFinal: {
    color: Colors.gray,
    fontSize: Typography.base,
    marginTop: Spacing.md,
    textAlign: 'center'
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.accent,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: 25
  },
  retryText: {
    color: Colors.white,
    fontSize: Typography.base,
    marginLeft: Spacing.sm,
    fontWeight: Typography.medium
  },
  controlsOverlay: {
    position: 'absolute',
    bottom: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    gap: Spacing.md
  },
  audioControlOverlay: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 120 : 120, // Same height as media type indicator
    right: Spacing.lg,
    zIndex: 10
  },
  audioButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  controlButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.8)'
  }
})

VideoPlayerWrapper.displayName = 'VideoPlayerWrapper'

export default VideoPlayerWrapper
