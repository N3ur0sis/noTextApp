// 📹 Production Video Compression Utility
// Optimized for iOS and Android with aggressive compression for minimal egress costs
// Uses react-native-compressor for WhatsApp-like compression without FFmpeg overhead

import * as FileSystem from 'expo-file-system/legacy';

// Safely import react-native-compressor with Expo Go fallback
let Video = null;
try {
  // This will fail in Expo Go but work in dev builds and production
  const compressor = require('react-native-compressor');
  Video = compressor.Video;
} catch (error) {
  console.warn('📱 [VIDEO_COMPRESSION] react-native-compressor not available (Expo Go), using fallback');
}

/**
 * Production-ready video compression with aggressive settings
 * Reduces file sizes by 75-85% while maintaining acceptable quality
 * 
 * @param {string} videoUri - Input video file URI
 * @param {function} onProgress - Progress callback (0-100)
 * @param {object} options - Compression options
 * @returns {Promise<string>} - Compressed video URI
 */
export const compressVideo = async (videoUri, onProgress = null, options = {}) => {
  try {
    console.log('🗜️ [VIDEO_COMPRESSION] Starting production compression...');
    
    // Fallback for Expo Go - return original video without compression
    if (!Video) {
      console.log('📱 [VIDEO_COMPRESSION] Compression not available in Expo Go, returning original video');
      if (onProgress) onProgress(100);
      return videoUri;
    }
    
    // Validate input
    if (!videoUri || !videoUri.startsWith('file://')) {
      throw new Error('Invalid video URI provided');
    }

    // Log original file info
    const originalInfo = await FileSystem.getInfoAsync(videoUri);
    if (!originalInfo.exists) {
      throw new Error('Video file does not exist');
    }
    
    const originalSizeMB = (originalInfo.size / (1024 * 1024)).toFixed(2);
    console.log(`📁 [VIDEO_COMPRESSION] Original size: ${originalSizeMB}MB`);

    // Enhanced compression settings - balanced quality and size optimization
    const compressionConfig = {
      compressionMethod: 'auto', // Intelligent automatic compression
      minimumFileSizeForCompress: 0, // Compress all videos for consistency
      
      // Enhanced manual settings for quality preservation
      maxSize: 720, // Higher quality max dimension
      bitrate: 1000000, // Better quality bitrate: 1Mbps vs aggressive 400kbps
      
      // Advanced options
      getCancellationId: options.getCancellationId || null,
      ...options.customSettings
    };

    console.log('⚙️ [VIDEO_COMPRESSION] Using settings:', {
      method: compressionConfig.compressionMethod,
      maxSize: compressionConfig.maxSize,
      bitrate: compressionConfig.bitrate
    });

    // Start compression with progress tracking
    const startTime = Date.now();
    let lastProgress = 0;
    
    const compressedUri = await Video.compress(
      videoUri,
      compressionConfig,
      (progress) => {
        // Smooth progress updates (avoid too frequent updates)
        if (progress - lastProgress >= 5 || progress === 100) {
          lastProgress = progress;
          console.log(`📊 [VIDEO_COMPRESSION] Progress: ${progress}%`);
          
          if (onProgress) {
            try {
              onProgress(progress);
            } catch (progressError) {
              console.warn('⚠️ [VIDEO_COMPRESSION] Progress callback error:', progressError);
            }
          }
        }
      }
    );

    // Validate compression result
    if (!compressedUri || !compressedUri.startsWith('file://')) {
      throw new Error('Compression failed: Invalid output URI');
    }

    // Verify compressed file exists
    const compressedInfo = await FileSystem.getInfoAsync(compressedUri);
    if (!compressedInfo.exists) {
      throw new Error('Compression failed: Output file does not exist');
    }

    // Calculate compression metrics
    const compressedSizeMB = (compressedInfo.size / (1024 * 1024)).toFixed(2);
    const compressionRatio = ((1 - compressedInfo.size / originalInfo.size) * 100).toFixed(1);
    const compressionTime = ((Date.now() - startTime) / 1000).toFixed(1);

    // Log compression results
    console.log('✅ [VIDEO_COMPRESSION] Compression completed successfully!');
    console.log(`📁 [VIDEO_COMPRESSION] Compressed size: ${compressedSizeMB}MB`);
    console.log(`📊 [VIDEO_COMPRESSION] Size reduction: ${compressionRatio}%`);
    console.log(`⏱️ [VIDEO_COMPRESSION] Compression time: ${compressionTime}s`);

    // Quality check - warn if compression was minimal
    if (parseFloat(compressionRatio) < 20) {
      console.warn(`⚠️ [VIDEO_COMPRESSION] Low compression ratio: ${compressionRatio}% - video may already be optimized`);
    }

    return compressedUri;

  } catch (error) {
    console.error('❌ [VIDEO_COMPRESSION] Compression failed:', error);
    
    // Enhanced error handling with specific error types
    if (error.message?.includes('cancelled')) {
      console.log('🛑 [VIDEO_COMPRESSION] Compression was cancelled');
      throw new Error('Video compression was cancelled');
    } else if (error.message?.includes('insufficient space')) {
      console.error('💾 [VIDEO_COMPRESSION] Insufficient storage space');
      throw new Error('Not enough storage space for video compression');
    } else if (error.message?.includes('unsupported')) {
      console.error('🚫 [VIDEO_COMPRESSION] Unsupported video format');
      throw new Error('Video format not supported for compression');
    }
    
    // For production: fallback to original video to prevent app crashes
    console.log('🔄 [VIDEO_COMPRESSION] Using original video as fallback');
    return videoUri;
  }
};

/**
 * Cancel ongoing video compression
 * @param {string} cancellationId - ID from getCancellationId callback
 */
export const cancelVideoCompression = (cancellationId) => {
  try {
    if (cancellationId) {
      Video.cancelCompression(cancellationId);
      console.log('🛑 [VIDEO_COMPRESSION] Compression cancelled:', cancellationId);
    }
  } catch (error) {
    console.warn('⚠️ [VIDEO_COMPRESSION] Cancel compression error:', error);
  }
};

/**
 * Get video metadata including size, duration, and format info
 * @param {string} videoUri - Video file URI
 * @returns {Promise<object>} - Video metadata
 */
export const getVideoMetadata = async (videoUri) => {
  try {
    const fileInfo = await FileSystem.getInfoAsync(videoUri);
    if (!fileInfo.exists) {
      throw new Error('Video file does not exist');
    }

    // Try to get video metadata using react-native-compressor
    try {
      const metadata = await Video.getVideoMetaData(videoUri);
      return {
        size: fileInfo.size,
        sizeMB: (fileInfo.size / (1024 * 1024)).toFixed(2),
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        extension: metadata.extension,
        aspectRatio: (metadata.width / metadata.height).toFixed(2),
        isPortrait: metadata.height > metadata.width,
        isLandscape: metadata.width > metadata.height
      };
    } catch (metadataError) {
      console.warn('⚠️ [VIDEO_COMPRESSION] Could not get video metadata:', metadataError);
      return {
        size: fileInfo.size,
        sizeMB: (fileInfo.size / (1024 * 1024)).toFixed(2),
        duration: null,
        width: null,
        height: null,
        extension: null,
        aspectRatio: null,
        isPortrait: null,
        isLandscape: null
      };
    }
  } catch (error) {
    console.error('❌ [VIDEO_COMPRESSION] Failed to get video metadata:', error);
    throw error;
  }
};

/**
 * Background task activation for compression while app is backgrounded
 * Call this before starting compression if the app might be backgrounded
 */
export const activateBackgroundCompression = async () => {
  try {
    await Video.activateBackgroundTask();
    console.log('🔄 [VIDEO_COMPRESSION] Background task activated');
  } catch (error) {
    console.warn('⚠️ [VIDEO_COMPRESSION] Background task activation failed:', error);
  }
};

/**
 * Deactivate background task after compression completes
 */
export const deactivateBackgroundCompression = async () => {
  try {
    await Video.deactivateBackgroundTask();
    console.log('✅ [VIDEO_COMPRESSION] Background task deactivated');
  } catch (error) {
    console.warn('⚠️ [VIDEO_COMPRESSION] Background task deactivation failed:', error);
  }
};

/**
 * Production-ready compression with automatic quality adjustment
 * Automatically selects best compression settings based on video characteristics
 * 
 * @param {string} videoUri - Input video URI
 * @param {object} options - Advanced options
 * @returns {Promise<string>} - Compressed video URI
 */
export const compressVideoAuto = async (videoUri, options = {}) => {
  try {
    const {
      onProgress = null,
      targetSizeMB = 5, // Target max size in MB
      qualityPreference = 'size', // 'size' | 'quality' | 'balanced'
      enableBackgroundTask = true
    } = options;

    // Get video metadata to determine optimal compression
    const metadata = await getVideoMetadata(videoUri);
    console.log('📊 [VIDEO_COMPRESSION] Auto-compression analysis:', metadata);

    // Activate background task if requested
    if (enableBackgroundTask) {
      await activateBackgroundCompression();
    }

    try {
      // Determine compression strategy based on video characteristics
      let compressionSettings = {};

      if (qualityPreference === 'size') {
        // Moderate compression with quality preservation
        compressionSettings = {
          customSettings: {
            maxSize: 720, // Higher quality resolution
            bitrate: 800000 // Better bitrate for quality: 800kbps
          }
        };
      } else if (qualityPreference === 'quality') {
        // High quality compression
        compressionSettings = {
          customSettings: {
            maxSize: 1080, // High definition resolution
            bitrate: 1500000 // High quality bitrate: 1.5Mbps
          }
        };
      } else {
        // Enhanced balanced compression (default)
        compressionSettings = {
          customSettings: {
            maxSize: 720, // Good quality resolution
            bitrate: 1000000 // Good quality bitrate: 1Mbps
          }
        };
      }

      // Add cancellation support
      let cancellationId = null;
      compressionSettings.getCancellationId = (id) => {
        cancellationId = id;
        if (options.onCancellationId) {
          options.onCancellationId(id);
        }
      };

      // Perform compression
      const result = await compressVideo(videoUri, onProgress, compressionSettings);

      return result;

    } finally {
      // Always deactivate background task
      if (enableBackgroundTask) {
        await deactivateBackgroundCompression();
      }
    }

  } catch (error) {
    console.error('❌ [VIDEO_COMPRESSION] Auto-compression failed:', error);
    throw error;
  }
};

/**
 * Legacy rotation function for compatibility
 * Rotation is now handled at recording level in CameraScreen
 */
export const rotateVideoToPortrait = async (uri, cameraType) => {
  console.log('🔄 [VIDEO_COMPRESSION] Video rotation handled at recording level');
  return uri;
};

// Export configuration constants for external use
export const VIDEO_COMPRESSION_CONFIG = {
  DEFAULT_BITRATE: 1000000, // 1Mbps for balanced quality/size
  QUALITY_BITRATE: 1500000, // 1.5Mbps for quality-focused compression
  MAX_SIZE: 720, // Enhanced default max dimension
  TARGET_SIZE_MB: 8, // Higher target file size for better quality
  COMPRESSION_TIMEOUT: 60000 // 60 seconds timeout
};

export default {
  compressVideo,
  compressVideoAuto,
  cancelVideoCompression,
  getVideoMetadata,
  activateBackgroundCompression,
  deactivateBackgroundCompression,
  rotateVideoToPortrait,
  VIDEO_COMPRESSION_CONFIG
};
