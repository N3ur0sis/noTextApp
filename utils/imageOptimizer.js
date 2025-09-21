/**
 * Image optimization utility for faster uploads
 * Especially optimized for Android performance
 */

import * as FileSystem from 'expo-file-system/legacy'
import * as ImageManipulator from 'expo-image-manipulator'
import { Platform } from 'react-native'

// Platform-specific optimization settings - AGGRESSIVE compression for messaging app
const OPTIMIZATION_SETTINGS = {
  android: {
    maxWidth: 800,       // Much smaller - perfect for mobile messaging
    maxHeight: 1200,     // Reasonable height limit for portraits
    quality: 0.6,        // Aggressive compression while maintaining readability
    format: ImageManipulator.SaveFormat.JPEG
  },
  ios: {
    maxWidth: 800,       // Consistent with Android - smaller files
    maxHeight: 1200,     // Same height limit
    quality: 0.65,       // Slightly higher for iOS (better JPEG encoder)
    format: ImageManipulator.SaveFormat.JPEG
  }
}

/**
 * Optimize image for upload with platform-specific settings
 * @param {string} uri - Original image URI
 * @param {string} mediaType - 'photo' or 'video'
 * @returns {string} - Optimized image URI
 */
export const optimizeImageForUpload = async (uri, mediaType = 'photo') => {
  try {
    const startTime = Date.now()
    
    // Skip optimization for videos (they're already compressed)
    if (mediaType === 'video') {
      return uri
    }
    
    // Get file info to check if optimization is needed
    const fileInfo = await FileSystem.getInfoAsync(uri)
    const fileSizeMB = fileInfo.size / (1024 * 1024)
    
    console.log(`📸 Original image: ${fileSizeMB.toFixed(2)}MB`)
    
    // ALWAYS optimize images > 50KB for messaging app efficiency
    if (fileSizeMB < 0.05) {
      console.log(`⚡ Skipping optimization - file tiny (< 50KB)`)
      return uri
    }
    
    const settings = OPTIMIZATION_SETTINGS[Platform.OS] || OPTIMIZATION_SETTINGS.android
    
    console.log(`${Platform.OS === 'android' ? '🤖' : '🍎'} Optimizing with settings:`, settings)
    
    // STEP 1: Resize to reasonable dimensions
    const resizedResult = await ImageManipulator.manipulateAsync(
      uri,
      [
        {
          resize: {
            width: settings.maxWidth,
            // Remove height constraint to preserve aspect ratio
            // ImageManipulator will automatically calculate height
          }
        }
      ],
      {
        compress: settings.quality,
        format: settings.format,
        base64: false
      }
    )
    
    // Check if we need additional compression
    let finalResult = resizedResult
    let resizedInfo = await FileSystem.getInfoAsync(resizedResult.uri)
    let resizedSizeMB = resizedInfo.size / (1024 * 1024)
    
    console.log(`📐 After resize: ${resizedSizeMB.toFixed(2)}MB`)
    
    // STEP 2: If still > 100KB, apply more aggressive compression
    if (resizedSizeMB > 0.1) {
      console.log(`🔄 File still large (${resizedSizeMB.toFixed(2)}MB), applying extra compression...`)
      
      finalResult = await ImageManipulator.manipulateAsync(
        resizedResult.uri,
        [], // No additional transforms
        {
          compress: 0.4, // Very aggressive compression
          format: settings.format,
          base64: false
        }
      )
      
      // Final check
      const finalInfo = await FileSystem.getInfoAsync(finalResult.uri)
      const finalSizeMB = finalInfo.size / (1024 * 1024)
      console.log(`🎯 After extra compression: ${finalSizeMB.toFixed(2)}MB`)
    }
    
    // Check the final optimized file size
    const optimizedInfo = await FileSystem.getInfoAsync(finalResult.uri)
    const optimizedSizeMB = optimizedInfo.size / (1024 * 1024)
    const reductionPercent = ((fileSizeMB - optimizedSizeMB) / fileSizeMB * 100).toFixed(1)
    
    const optimizationTime = Date.now() - startTime
    console.log(`✅ Image optimized in ${optimizationTime}ms: ${fileSizeMB.toFixed(2)}MB → ${optimizedSizeMB.toFixed(2)}MB (${reductionPercent}% reduction)`)
    
    // Warn if still large for messaging
    if (optimizedSizeMB > 0.15) {
      console.warn(`⚠️ Final image still large: ${optimizedSizeMB.toFixed(2)}MB - consider further optimization`)
    }
    
    return finalResult.uri
    
  } catch (error) {
    console.warn('⚠️ Image optimization failed, using original:', error)
    return uri
  }
}

/**
 * Quick image info utility
 * @param {string} uri - Image URI
 * @returns {Object} - File info with size in MB
 */
export const getImageInfo = async (uri) => {
  try {
    const fileInfo = await FileSystem.getInfoAsync(uri)
    return {
      ...fileInfo,
      sizeMB: (fileInfo.size / (1024 * 1024)).toFixed(2)
    }
  } catch (error) {
    console.warn('Failed to get image info:', error)
    return null
  }
}

/**
 * Estimate upload time based on file size and connection
 * @param {number} fileSizeMB - File size in MB
 * @param {string} connectionType - 'wifi', '4g', '3g', 'slow'
 * @returns {number} - Estimated upload time in seconds
 */
export const estimateUploadTime = (fileSizeMB, connectionType = 'wifi') => {
  const speeds = {
    wifi: 10,      // 10 MB/s
    '4g': 2,       // 2 MB/s
    '3g': 0.5,     // 0.5 MB/s
    slow: 0.1      // 0.1 MB/s
  }
  
  const speed = speeds[connectionType] || speeds['4g']
  return Math.ceil(fileSizeMB / speed)
}
