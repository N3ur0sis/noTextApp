import { VideoView, useVideoPlayer } from 'expo-video'
import React, { useEffect, useState, useRef } from 'react'
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
  onDurationLoad = null, // New callback for duration
  onVideoEnd = null, // New callback for video end
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
        
        // Call onLoad callback when player is ready
        if (onLoad) {
          onLoad(player)
        }
      }
    }
  )

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
          
          // Use unified media service for consistent caching
          const cachedUrl = await unifiedMediaService.getCachedFile(sourceUri, 'video', priority)
          
          setResolvedSource(cachedUrl)
          
          if (__DEV__) {
            const filename = cachedUrl?.split('/').pop()?.split('?')[0] || 'unknown'
            console.log(`✅ [CACHED_VIDEO] Resolved: ${cachedUrl?.startsWith('file://') ? 'LOCAL' : 'REMOTE'} - ${filename}`)
          }
        } catch (error) {
          console.warn('❌ [CACHED_VIDEO] Error resolving source:', error)
          setResolvedSource(sourceUri) // Fallback to original source
          
          if (onError) {
            onError(error)
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
  }, [source, priority, onError, onLoad])

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

  // Handle external player setup
  useEffect(() => {
    if (externalPlayer && !shouldCreateInternalPlayer && onLoad) {
      // Call onLoad for external players to notify VideoPlayerWrapper
      onLoad(externalPlayer)
    }
  }, [externalPlayer, shouldCreateInternalPlayer, onLoad])

  // Update internal player source when resolved source changes
  useEffect(() => {
    if (shouldCreateInternalPlayer && internalVideoPlayer) {
      const sourceToUse = resolvedSource || (typeof source === 'string' ? source : source?.uri)
      
      if (sourceToUse) {
        try {
          internalVideoPlayer.replace(sourceToUse)
          
          // Always call onLoad to notify parent component (like VideoPlayerWrapper)
          if (onLoad) {
            onLoad(internalVideoPlayer)
          }
        } catch (error) {
          console.warn('⚠️ [CACHED_VIDEO] Player replace error:', error)
          if (onError) {
            onError(error)
          }
        }
      }
    }
  }, [resolvedSource, source, internalVideoPlayer, shouldCreateInternalPlayer, onLoad, onError])

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

export default CachedVideo
