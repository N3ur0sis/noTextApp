/**
 * Unified Media Type Utilities
 * Standardized media type indicators across all screens
 */

import { Colors } from '../constants/Design'

/**
 * Get media type information based on message properties
 * Uses the same icons and logic as the camera screen
 */
export const getMediaTypeInfo = (message) => {
  if (!message?.media_url) return null

  // Check for NSFW content
  if (message.is_nsfw) {
    return { 
      icon: 'flame', 
      color: Colors.fire || '#FF6B6B', 
      backgroundColor: 'rgba(255, 107, 107, 0.8)'
    }
  }
  
  // Check for one-time view - now with yellow color and better visibility
  if (message.view_once || message.is_one_time) {
    return { 
      icon: 'eye', 
      color: '#FFFFFF', // White icon for better contrast
      backgroundColor: 'rgba(255, 193, 7, 0.9)' // Yellow background with better opacity
    }
  }
  
  // Default to permanent
  return { 
    icon: 'infinite', 
    color: '#FFFFFF', // White icon for better contrast
    backgroundColor: 'rgba(59, 130, 246, 0.8)' // Blue background with better opacity
  }
}

/**
 * Get video indicator info
 */
export const getVideoIndicatorInfo = () => ({
  icon: 'play',
  color: Colors.white,
  backgroundColor: 'rgba(0, 0, 0, 0.6)'
})

/**
 * Check if message should show media type indicator
 */
export const shouldShowMediaTypeIndicator = (message) => {
  return Boolean(message?.media_url)
}

/**
 * Get media preview source (handles video thumbnails)
 */
export const getMediaPreviewSource = (message) => {
  if (!message?.media_url) return null
  
  const isVideo = message.media_type === 'video' || message.latestMediaType === 'video'
  const thumb = message.thumbnail_url || message.latestThumbnailUrl
  // Always prefer a thumbnail in list previews if available
  return thumb ?? message.media_url
}

/**
 * Check if should show placeholder instead of media
 */
export const shouldShowMediaPlaceholder = (message) => {
  if (!message?.media_url) return true
  
  const isVideo = message.media_type === 'video' || message.latestMediaType === 'video'
  const thumbnailUrl = message.thumbnail_url || message.latestThumbnailUrl
  
  return isVideo && !thumbnailUrl
}
