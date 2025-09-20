import { VideoView, useVideoPlayer } from 'expo-video'
import React, { useEffect, useState, useRef, memo } from 'react'
import { Platform } from 'react-native'
import { unifiedMediaService } from '../services/unifiedMediaService'

/**
 * Enhanced CachedVideo component - Production ready with advanced controls
 * Features: Smart caching, performance optimization, media type support
 */
const CachedVideo = ({ 
  source, 
  priority = 'normal', 
  player: externalPlayer, 
  shouldPlay = false,
  isLooping = true,
  isMuted = true,
  useNativeControls = false,
  autoPlay = false,
  onLoad = null,
  onError = null,
  onPlaybackStatusUpdate = null,
  mediaType = 'permanent', // 'permanent', 'one_time', 'nsfw'
  ...props 
}) => {
  // Debug: Log component instantiation
  if (__DEV__) {
    const sourceUri = typeof source === 'string' ? source : source?.uri
    const filename = sourceUri?.split('/').pop()?.split('?')[0] || 'unknown'
    console.log(`🎯 [CACHED_VIDEO] Component instantiated for: ${filename}`)
  }

  const [resolvedSource, setResolvedSource] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const playerRef = useRef(null)
  
  // Use refs for callbacks to prevent re-renders
  const onLoadRef = useRef(onLoad)
  const onErrorRef = useRef(onError)
  
  // Update refs when props change
  useEffect(() => {
    onLoadRef.current = onLoad
  }, [onLoad])
  
  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  // Only create internal player if no external player is provided
  const shouldCreateInternalPlayer = !externalPlayer
  
  // Enhanced video player with production-ready configuration
  const internalVideoPlayer = useVideoPlayer(
    shouldCreateInternalPlayer ? (resolvedSource || (typeof source === 'string' ? source : source?.uri)) : null, 
    player => {
      if (player && shouldCreateInternalPlayer) {
        // Store player reference
        playerRef.current = player
        
        // Configure player for optimal performance
        player.muted = isMuted
        player.loop = isLooping
        player.allowsExternalPlayback = false
        player.showsPlaybackControls = useNativeControls
        player.timeUpdateEventInterval = 1000
        
        // Disable native APIs that could cause performance issues
        if (Platform.OS === 'ios') {
          player.allowsPictureInPicturePlayback = false
          player.allowsAirPlay = false
        }
        
        // Auto-play if requested and should play
        if (autoPlay && shouldPlay) {
          player.play()
        }
        
        // Don't call onLoad here - it causes setState during render
        // Instead, we'll call it in a useEffect
      }
    }
  )

  // Handle all onLoad notifications in a single effect with proper timing
  useEffect(() => {
    // Use setTimeout to ensure this runs after the render cycle completes
    const timer = setTimeout(() => {
      if (onLoadRef.current) {
        const playerToNotify = externalPlayer || (shouldCreateInternalPlayer ? internalVideoPlayer : null)
        if (playerToNotify) {
          console.log('🎯 [CACHED_VIDEO] Notifying parent of player load (delayed)')
          onLoadRef.current(playerToNotify)
        }
      }
    }, 16) // Use 16ms (1 frame) instead of 0 for better timing
    
    return () => clearTimeout(timer)
  }, [externalPlayer, shouldCreateInternalPlayer, internalVideoPlayer])

  // Handle source resolution with enhanced error handling
  useEffect(() => {
    const resolveUrl = async () => {
      if (!source) {
        setResolvedSource(null)
        setIsLoading(false)
        return
      }

      const sourceUri = typeof source === 'string' ? source : source.uri

      if (sourceUri && sourceUri.includes('/media/')) {
        try {
          setIsLoading(true)

          if (__DEV__) {
            const filename = sourceUri.split('/').pop()?.split('?')[0] || 'unknown'
            console.log(`🎯 [CACHED_VIDEO] Resolving: ${filename}`)
          }

          // Use unified media service for consistent caching/resolution
          const cachedUrl = await unifiedMediaService.getCachedFile(sourceUri, 'video')

          setResolvedSource(cachedUrl)

          if (__DEV__) {
            const filename = cachedUrl?.split('/').pop()?.split('?')[0] || 'unknown'
            console.log(`✅ [CACHED_VIDEO] Resolved: ${cachedUrl?.startsWith('file://') ? 'LOCAL' : 'REMOTE'} - ${filename}`)
          }

          // Call onLoad callback for external players when source is ready
          if (onLoadRef.current && externalPlayer) {
            // Use setTimeout to avoid calling during render
            setTimeout(() => {
              if (onLoadRef.current) {
                onLoadRef.current(externalPlayer)
              }
            }, 0)
          }
        } catch (err) {
          console.warn('❌ [CACHED_VIDEO] Error resolving source:', err)
          setResolvedSource(sourceUri) // Fallback to original source

          if (onErrorRef.current) {
            onErrorRef.current(err)
          }
        } finally {
          setIsLoading(false)
        }
      } else {
        // Non-media URLs don't need processing
        setResolvedSource(sourceUri)
        setIsLoading(false)
      }
    }

    resolveUrl()
  }, [source, priority])

  // Handle playback control
  useEffect(() => {
    const player = externalPlayer || internalVideoPlayer
    
    if (player && (resolvedSource || source)) {
      try {
        if (shouldPlay) {
          player.play()
        } else {
          player.pause()
        }
      } catch (error) {
        console.warn('⚠️ [CACHED_VIDEO] Playback control error:', error)
      }
    }
  }, [shouldPlay, externalPlayer, internalVideoPlayer, resolvedSource, source])

  // Update internal player source when resolved source changes
  useEffect(() => {
    if (shouldCreateInternalPlayer && internalVideoPlayer) {
      const sourceToUse = resolvedSource || (typeof source === 'string' ? source : source?.uri)
      
      if (sourceToUse) {
        try {
          internalVideoPlayer.replace(sourceToUse)
          
          // onLoad notification is now handled in the consolidated useEffect above
        } catch (error) {
          console.warn('⚠️ [CACHED_VIDEO] Player replace error:', error)
          if (onErrorRef.current) {
            onErrorRef.current(error)
          }
        }
      }
    }
  }, [resolvedSource, source, internalVideoPlayer, shouldCreateInternalPlayer])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (shouldCreateInternalPlayer && playerRef.current) {
        try {
          playerRef.current.pause()
          playerRef.current = null
        } catch (error) {
          console.warn('⚠️ [CACHED_VIDEO] Cleanup error:', error)
        }
      }
    }
  }, [shouldCreateInternalPlayer])

  // Always render the VideoView, but handle loading states properly
  const videoPlayer = externalPlayer || internalVideoPlayer
  
  // If we have a resolved source, use it; otherwise use original source for fallback
  const sourceToUse = resolvedSource || (typeof source === 'string' ? source : source?.uri)

  // Debug logging for troubleshooting
  if (__DEV__) {
    console.log(`🎯 [CACHED_VIDEO] Render check - source: ${!!sourceToUse}, player: ${!!videoPlayer}, resolvedSource: ${!!resolvedSource}, isLoading: ${isLoading}`)
    if (sourceToUse) {
      console.log(`🎯 [CACHED_VIDEO] Source URI: ${sourceToUse.split('/').pop()}`)
    }
  }

  // Only render if we have a source and player
  if (!sourceToUse || !videoPlayer) {
    if (__DEV__) {
      console.log(`🎯 [CACHED_VIDEO] Not rendering - source: ${!!sourceToUse}, player: ${!!videoPlayer}`)
    }
    return null
  }

  if (__DEV__ && !resolvedSource && sourceToUse) {
    console.log(`⚠️ [CACHED_VIDEO] Using fallback source: ${sourceToUse.split('/').pop()}`)
  }

  return (
    <VideoView 
      player={videoPlayer}
      nativeControls={useNativeControls}
      allowsFullscreen={false}
      allowsPictureInPicture={false}
      contentFit="cover"
      {...props} 
    />
  )
}

// Custom comparison function for memo to handle callback prop changes more effectively
const arePropsEqual = (prevProps, nextProps) => {
  // Check if source has changed (most important prop)
  if (prevProps.source !== nextProps.source) {
    return false
  }
  
  // Check other important props that should trigger re-render
  const importantProps = ['shouldPlay', 'isLooping', 'isMuted', 'useNativeControls', 'autoPlay', 'contentFit']
  for (const prop of importantProps) {
    if (prevProps[prop] !== nextProps[prop]) {
      return false
    }
  }
  
  // For callback props, only check if they changed from undefined to defined or vice versa
  // Don't trigger re-render for callback reference changes if both are functions
  const callbackProps = ['onLoad', 'onError', 'onPlaybackStatusUpdate', 'onDurationLoad', 'onVideoEnd']
  for (const prop of callbackProps) {
    const prevIsDefined = typeof prevProps[prop] === 'function'
    const nextIsDefined = typeof nextProps[prop] === 'function'
    if (prevIsDefined !== nextIsDefined) {
      return false
    }
  }
  
  return true
}

export default memo(CachedVideo, arePropsEqual)
