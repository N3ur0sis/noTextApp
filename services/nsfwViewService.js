/**
 * NSFW View Service - Production Ready
 * Handles timed viewing for NSFW messages with automatic removal after viewing
 * OPTIMIZED: Added AppState handling to prevent timer reset on app switching
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState } from 'react-native'

class NSFWViewService {
  constructor() {
    this.viewedMessages = new Set() // Messages viewed with timer completion
    this.currentlyViewing = new Map() // Currently active timers: messageId -> { timer, startTime, duration }
    this.initialized = false
    this.storageKey = '@nsfw_viewed_messages'
    
    // OPTIMIZATION: AppState handling to prevent timer reset
    this.appStateListener = null
    this.backgroundStartTime = null
    this.pausedTimers = new Map() // Store paused timer state
  }

  /**
   * Initialize the service - restore viewed messages from storage
   */
  async init() {
    if (this.initialized) return
    
    try {
      const stored = await AsyncStorage.getItem(this.storageKey)
      if (stored) {
        const viewedArray = JSON.parse(stored)
        this.viewedMessages = new Set(viewedArray)
        if (__DEV__) console.log('📱 [NSFW_VIEW] Restored viewed messages:', viewedArray.length)
      }
      
      // OPTIMIZATION: Setup AppState listener for timer management
      this.setupAppStateListener()
      
    } catch (error) {
      console.error('❌ [NSFW_VIEW] Failed to restore from storage:', error)
    }
    
    this.initialized = true
  }

  /**
   * OPTIMIZATION: Setup AppState listener to handle timer pausing
   */
  setupAppStateListener() {
    if (this.appStateListener) return // Already setup
    
    this.appStateListener = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        this.pauseTimers()
      } else if (nextAppState === 'active') {
        this.resumeTimers()
      }
    })
  }

  /**
   * OPTIMIZATION: Pause all active timers when app goes to background
   */
  pauseTimers() {
    if (__DEV__) console.log('⏸️ [NSFW_VIEW] Pausing timers for background')
    this.backgroundStartTime = Date.now()
    
    for (const [messageId, viewingData] of this.currentlyViewing.entries()) {
      const elapsed = Date.now() - viewingData.startTime
      const remaining = Math.max(0, viewingData.duration - elapsed)
      
      this.pausedTimers.set(messageId, {
        remaining,
        originalData: viewingData
      })
      
      // Clear the active timer
      if (viewingData.timer) {
        clearTimeout(viewingData.timer)
      }
      if (viewingData.progressInterval) {
        clearInterval(viewingData.progressInterval)
      }
    }
  }

  /**
   * OPTIMIZATION: Resume timers when app comes back to foreground
   */
  resumeTimers() {
    if (__DEV__) console.log('▶️ [NSFW_VIEW] Resuming timers from background')
    
    for (const [messageId, pausedData] of this.pausedTimers.entries()) {
      const { remaining, originalData } = pausedData
      
      if (remaining > 0) {
        // Resume with remaining time
        this.resumeTimer(messageId, remaining, originalData)
      } else {
        // Timer should have completed while in background
        if (originalData.onComplete) {
          originalData.onComplete()
        }
      }
    }
    
    this.pausedTimers.clear()
  }

  /**
   * OPTIMIZATION: Resume a specific timer with remaining time
   */
  resumeTimer(messageId, remainingTime, originalData) {
    const startTime = Date.now()
    
    // Create new progress interval
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime
      const totalElapsed = originalData.duration - remainingTime + elapsed
      const progress = Math.min(totalElapsed / originalData.duration, 0.99)
      
      if (originalData.onProgress) {
        originalData.onProgress(progress)
      }
      
      if (progress >= 0.99) {
        clearInterval(progressInterval)
      }
    }, 100)

    // Create new timer with remaining time
    const timer = setTimeout(async () => {
      clearInterval(progressInterval)
      
      if (originalData.onComplete) {
        originalData.onComplete()
      }
      
      // FIXED: Ensure database update and real-time events are sent
      await this.completeViewing(messageId, originalData.currentUserId)
      
      // Clean up
      this.currentlyViewing.delete(messageId)
      
      if (__DEV__) console.log(`✅ [NSFW_VIEW] Timer resumed and completed for ${messageId}`)
    }, remainingTime)

    // Update currently viewing with resumed timer
    this.currentlyViewing.set(messageId, {
      ...originalData,
      timer,
      progressInterval,
      startTime: startTime - (originalData.duration - remainingTime) // Adjust start time
    })
  }

  /**
   * Persist viewed messages to storage
   */
  async persistViewedMessages() {
    try {
      const viewedArray = Array.from(this.viewedMessages)
      await AsyncStorage.setItem(this.storageKey, JSON.stringify(viewedArray))
      if (__DEV__) console.log('💾 [NSFW_VIEW] Persisted viewed messages:', viewedArray.length)
    } catch (error) {
      console.error('❌ [NSFW_VIEW] Failed to persist to storage:', error)
    }
  }

  /**
   * Start viewing an NSFW message with timer
   * @param {string} messageId - The message ID
   * @param {string} mediaType - 'photo' or 'video'
   * @param {number} videoDuration - Duration in seconds for videos
   * @param {string} currentUserId - Current user ID
   * @param {Function} onProgress - Progress callback (progress: 0-1)
   * @param {Function} onComplete - Completion callback
   * @param {Function} onRemove - Removal callback
   * @param {Function} onVideoLoaded - Callback when video player is loaded (for getting actual duration)
   * @returns {Promise<boolean>} - Success status
   */
  async startViewing(messageId, mediaType, videoDuration = 0, currentUserId = null, onProgress = null, onComplete = null, onRemove = null, onVideoLoaded = null) {
    await this.init()
    
    if (!messageId || this.viewedMessages.has(messageId)) {
      if (__DEV__) console.log('⚠️ [NSFW_VIEW] Message already viewed or invalid:', messageId)
      return false
    }

    // Stop any existing timer for this message
    this.stopViewing(messageId, false)

    // For videos, we might get the actual duration from the video player
    // For now, use provided duration or default values
    let duration
    if (mediaType === 'video') {
      // Use provided duration or default to 10 seconds, minimum 3 seconds
      duration = Math.max((videoDuration || 10) * 1000, 3000)
      if (__DEV__) console.log(`🎥 [NSFW_VIEW] Video duration: ${videoDuration}s (${duration}ms)`)
    } else {
      // Photos: 5 seconds
      duration = 5000
    }
    
    const startTime = Date.now()
    
    if (__DEV__) console.log(`👁️ [NSFW_VIEW] Starting timer for ${messageId}: ${duration}ms (${mediaType})`)

    // Store viewing session data with callbacks for AppState handling
    const viewingData = {
      timer: null,
      progressInterval: null,
      startTime,
      duration,
      mediaType,
      currentUserId, // Store currentUserId for resume functionality
      onProgress,
      onComplete,
      onRemove,
      onVideoLoaded // Store video loaded callback
    }

    // For videos, we want to start the timer but allow updating duration when video loads
    if (mediaType === 'video' && onVideoLoaded) {
      // Store the viewing data first, timer will be created when video loads
      this.currentlyViewing.set(messageId, viewingData)
      
      // Call the video loaded callback to let the caller know we're ready for video load events
      onVideoLoaded((actualDuration) => {
        if (actualDuration && actualDuration > 0) {
          this.updateVideoDuration(messageId, actualDuration)
        }
      })
      
      return true
    }

    // For photos or when no video duration callback, start timer immediately
    this.startTimer(messageId, viewingData)
    return true
  }

  /**
   * Update video duration when actual duration is available from video player
   */
  updateVideoDuration(messageId, durationInSeconds) {
    const viewingData = this.currentlyViewing.get(messageId)
    if (!viewingData) {
      if (__DEV__) console.log('⚠️ [NSFW_VIEW] Cannot update duration - viewing session not found:', messageId)
      return
    }

    const newDuration = Math.max(durationInSeconds * 1000, 3000) // Minimum 3 seconds
    if (__DEV__) console.log(`🎥 [NSFW_VIEW] Updating video duration for ${messageId}: ${durationInSeconds}s (${newDuration}ms)`)
    
    // Update duration and restart timer with correct duration
    viewingData.duration = newDuration
    this.startTimer(messageId, viewingData)
  }

  /**
   * Start the actual timer and progress tracking
   */
  startTimer(messageId, viewingData) {
    const { duration, startTime, onProgress, onComplete, currentUserId } = viewingData
    
    // Clear any existing timers
    if (viewingData.timer) clearTimeout(viewingData.timer)
    if (viewingData.progressInterval) clearInterval(viewingData.progressInterval)

    // Create progress update interval
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 0.99) // Cap at 99% to avoid showing 100% before removal
      
      if (onProgress) {
        onProgress(progress)
      }
      
      if (progress >= 0.99) {
        clearInterval(progressInterval)
      }
    }, 100) // Update every 100ms for smooth progress

    // Create main timer
    const timer = setTimeout(async () => {
      if (__DEV__) console.log(`⏰ [NSFW_VIEW] Timer completed for ${messageId}`)
      
      // Clear progress interval
      clearInterval(progressInterval)
      
      // Call completion callback first (this triggers UI removal animation)
      if (onComplete) {
        onComplete()
      }
      
      // FIXED: Ensure database update and real-time events are sent
      await this.completeViewing(messageId, currentUserId)
      
      // Clean up viewing session
      this.currentlyViewing.delete(messageId)
      
      if (__DEV__) console.log(`✅ [NSFW_VIEW] Timer completed and message processed: ${messageId}`)
    }, duration)

    // Update viewing data with actual timer references
    viewingData.timer = timer
    viewingData.progressInterval = progressInterval
    
    // Update stored viewing session
    this.currentlyViewing.set(messageId, viewingData)
  }

  /**
   * Start viewing NSFW video with automatic completion when video ends
   * This method is specifically for videos that should play once and then be marked as seen
   * @param {string} messageId - The message ID
   * @param {string} currentUserId - Current user ID
   * @param {Function} onComplete - Completion callback
   * @param {Function} onVideoPlayerReady - Callback when video player should be prepared
   * @returns {Promise<boolean>} - Success status
   */
  async startVideoViewing(messageId, currentUserId, onComplete = null, onVideoPlayerReady = null) {
    await this.init()
    
    if (!messageId || this.viewedMessages.has(messageId)) {
      if (__DEV__) console.log('⚠️ [NSFW_VIEW] Message already viewed or invalid:', messageId)
      return false
    }

    // Stop any existing timer for this message
    this.stopViewing(messageId, false)
    
    if (__DEV__) console.log(`🎥 [NSFW_VIEW] Starting video viewing for ${messageId}`)

    // Store viewing session data for video mode
    let hasCompleted = false
    const viewingData = {
      timer: null,
      progressInterval: null,
      startTime: Date.now(),
      duration: null, // Will be set when video loads
      mediaType: 'video',
      currentUserId,
      isVideoMode: true, // Flag to indicate this is video-controlled viewing
      onComplete,
      onVideoPlayerReady,
      hasCompleted: () => hasCompleted
    }

    // Store viewing session
    this.currentlyViewing.set(messageId, viewingData)

    // Complete function - ensures it only runs once
    const completeOnce = () => {
      if (hasCompleted) return
      hasCompleted = true
      this.completeVideoViewing(messageId)
    }

    // Call the video player ready callback so the UI can prepare the video player
    if (onVideoPlayerReady) {
      onVideoPlayerReady({
        // Callback for when video actually ends
        onVideoEnded: () => {
          if (__DEV__) console.log(`🎬 [NSFW_VIEW] Video ended naturally: ${messageId}`)
          completeOnce()
        },
        // Callback for when video duration is available
        onDurationLoad: (duration) => {
          if (__DEV__) console.log(`🎬 [NSFW_VIEW] Video duration loaded: ${duration}s for ${messageId}`)
          
          // Set up fallback timer - if video end detection fails, use timer as backup
          const fallbackTime = Math.max(duration * 1000 + 2000, 5000) // Video duration + 2s buffer, minimum 5s
          
          const fallbackTimer = setTimeout(() => {
            if (!hasCompleted) {
              if (__DEV__) console.log(`⏰ [NSFW_VIEW] Fallback timer triggered for ${messageId}`)
              completeOnce()
            }
          }, fallbackTime)
          
          // Store fallback timer
          viewingData.timer = fallbackTimer
        },
        // Callback for when video starts playing (optional)
        onVideoStarted: () => {
          if (__DEV__) console.log(`▶️ [NSFW_VIEW] Video started playing: ${messageId}`)
        }
      })
    }

    return true
  }

  /**
   * Complete video viewing (called when video ends)
   */
  async completeVideoViewing(messageId) {
    const viewingData = this.currentlyViewing.get(messageId)
    if (!viewingData || !viewingData.isVideoMode) {
      if (__DEV__) console.log('⚠️ [NSFW_VIEW] Invalid video viewing session:', messageId)
      return
    }

    // Check if already completed using the hasCompleted function
    if (viewingData.hasCompleted && viewingData.hasCompleted()) {
      if (__DEV__) console.log('⚠️ [NSFW_VIEW] Video viewing already completed:', messageId)
      return
    }

    if (__DEV__) console.log(`🎬 [NSFW_VIEW] Video viewing completed for ${messageId}`)

    // Clear any fallback timer
    if (viewingData.timer) {
      clearTimeout(viewingData.timer)
    }

    // Call completion callback first
    if (viewingData.onComplete) {
      viewingData.onComplete()
    }

    // Mark as viewed and handle database update
    await this.completeViewing(messageId, viewingData.currentUserId)

    // Clean up viewing session
    this.currentlyViewing.delete(messageId)
  }

  /**
   * Stop viewing a message (called when user navigates away)
   * @param {string} messageId - The message ID
   * @param {boolean} markAsViewed - Whether to mark as viewed (default true)
   * @param {string} currentUserId - Current user ID
   */
  async stopViewing(messageId, markAsViewed = true, currentUserId = null) {
    if (!messageId) return false

    const viewingSession = this.currentlyViewing.get(messageId)
    if (!viewingSession) return false

    if (__DEV__) console.log(`🛑 [NSFW_VIEW] Stopping timer for ${messageId}, markAsViewed: ${markAsViewed}`)

    // Clear timers
    if (viewingSession.timer) {
      clearTimeout(viewingSession.timer)
    }
    if (viewingSession.progressInterval) {
      clearInterval(viewingSession.progressInterval)
    }

    // Remove from currently viewing
    this.currentlyViewing.delete(messageId)

    // Mark as viewed if requested (happens when user navigates away)
    if (markAsViewed) {
      await this.completeViewing(messageId, currentUserId)
      
      // Call removal callback for immediate UI update
      if (viewingSession.onRemove) {
        setTimeout(() => {
          viewingSession.onRemove()
        }, 100)
      }
    }

    return true
  }

  /**
   * Complete viewing process - mark as viewed permanently
   */
  async completeViewing(messageId, currentUserId = null) {
    await this.init()
    
    // Guard against duplicate processing
    if (this.viewedMessages.has(messageId)) {
      if (__DEV__) console.log('⚠️ [NSFW_VIEW] Message already marked as viewed, skipping duplicate processing:', messageId)
      return
    }
    
    // Mark as permanently viewed
    this.viewedMessages.add(messageId)
    await this.persistViewedMessages()
    
    if (__DEV__) console.log('🔒 [NSFW_VIEW] Message permanently viewed (filtered out):', messageId)
    
    // Update database with viewed_at timestamp and mark as seen
    if (currentUserId) {
      try {
        // Import supabase directly to avoid circular dependency with userService
        const { supabase } = await import('./supabaseClient')
        
        // Update the message as seen directly
        const { error } = await supabase
          .from('messages')
          .update({ 
            seen: true, 
            viewed_at: new Date().toISOString() 
          })
          .eq('id', messageId)
          .eq('receiver_id', currentUserId) // Only update if current user is receiver
          
        if (error) {
          console.error('❌ [NSFW_VIEW] Database update error:', error)
        } else {
          if (__DEV__) console.log('💾 [NSFW_VIEW] Database updated for message:', messageId)
          
          // ENHANCED: Remove NSFW media files from local storage after viewing
          try {
            const { data: messageDetails } = await supabase
              .from('messages')
              .select('media_url, media_type, thumbnail_url')
              .eq('id', messageId)
              .single()
            
            if (messageDetails?.media_url) {
              const { unifiedMediaService } = await import('./unifiedMediaService')
              const mediaType = messageDetails.media_type || 'image'
              const removed = await unifiedMediaService.removeNsfwMedia(messageDetails.media_url, mediaType)
              
              // Also remove thumbnail if it exists separately
              if (messageDetails.thumbnail_url && messageDetails.thumbnail_url !== messageDetails.media_url) {
                await unifiedMediaService.removeNsfwMedia(messageDetails.thumbnail_url, 'image')
              }
              
              if (removed && __DEV__) {
                console.log(`🗑️ [NSFW_VIEW] Successfully removed NSFW ${mediaType} from storage:`, messageId)
              }
            }
          } catch (mediaError) {
            console.error('❌ [NSFW_VIEW] Failed to remove NSFW media from storage:', mediaError)
          }
          
          // Get message details for real-time event
          const { data: messageData } = await supabase
            .from('messages')
            .select('sender_id, receiver_id')
            .eq('id', messageId)
            .single()
          
          if (messageData) {
            if (__DEV__) {
              console.log('📡 [NSFW_VIEW] Message details retrieved for real-time events:', {
                messageId,
                senderId: messageData.sender_id,
                receiverId: currentUserId,
                will_emit_events: ['messageRead', 'conversationUpdate', 'messageReadStatusUpdated']
              })
            }
            
            // Emit real-time event so sender also gets updated
            try {
              const realtimeCacheManagerModule = await import('./realtimeCacheManager')
              const realtimeManager = realtimeCacheManagerModule.realtimeCacheManager
              
              if (realtimeManager) {
                const eventData = {
                  messageId,
                  receiverId: currentUserId,
                  senderId: messageData.sender_id,
                  timestamp: new Date().toISOString(),
                  isNsfw: true
                }
                realtimeManager.emit('messageRead', eventData)
                if (__DEV__) console.log('📤 [NSFW_VIEW] Emitted messageRead event for NSFW completion')
                
                // ENHANCED: Also emit conversationUpdate to trigger immediate refresh on sender's side
                const conversationEventData = {
                  type: 'nsfw_message_viewed',
                  messageId,
                  senderId: messageData.sender_id,
                  receiverId: currentUserId,
                  timestamp: new Date().toISOString()
                }
                realtimeManager.emit('conversationUpdate', conversationEventData)
                if (__DEV__) console.log('📤 [NSFW_VIEW] Emitted conversationUpdate event for immediate sender refresh')
                
                // ENHANCED: Also emit messageReadStatusUpdated for additional coverage
                const statusEventData = {
                  messageId,
                  senderId: messageData.sender_id,
                  receiverId: currentUserId,
                  timestamp: new Date().toISOString(),
                  isNsfw: true,
                  viewed: true
                }
                realtimeManager.emit('messageReadStatusUpdated', statusEventData)
                if (__DEV__) console.log('📤 [NSFW_VIEW] Emitted messageReadStatusUpdated event for comprehensive coverage')
              }
            } catch (eventError) {
              console.error('❌ [NSFW_VIEW] Real-time event error:', eventError)
            }
          }
          
          // Update caches in-place to remove the viewed NSFW message without global invalidation
          try {
            const { apiManager } = await import('./apiManager')
            const { realtimeCacheManager } = await import('./realtimeCacheManager')

            const messageKey = `messages_currentUserId:${currentUserId}|otherUserId:${messageData?.sender_id}`
            const reverseMessageKey = `messages_currentUserId:${messageData?.sender_id}|otherUserId:${currentUserId}`

            // Remove the viewed message from the cached arrays for both perspectives
            try {
              const cached = apiManager.getFromCache(messageKey)
              if (!Array.isArray(cached)) {
                // Fallback to empty array from secondary cache
                const fallback = await import('./cacheService').then(m => m.default.get('message', `${messageData?.sender_id}_messages`) || [])
                if (!Array.isArray(fallback) || fallback.length === 0) {
                  // Nothing to do
                } else {
                  const cleaned = fallback.filter(m => !(m && m.id === messageId))
                  if (cleaned.length !== fallback.length) {
                    apiManager.setCache(messageKey, cleaned)
                  }
                }
              } else if (cached.length > 0) {
                const cleaned = cached.filter(m => !(m && m.id === messageId))
                if (cleaned.length !== cached.length) {
                  // Persist the cleaned array back to authoritative cache
                  apiManager.setCache(messageKey, cleaned)
                }
              }
            } catch (e) {
              if (__DEV__) console.warn('⚠️ [NSFW_VIEW] Failed to clean cache for key', messageKey, e)
            }

            try {
              const cachedRev = apiManager.getFromCache(reverseMessageKey)
              if (!Array.isArray(cachedRev)) {
                const fallbackRev = await import('./cacheService').then(m => m.default.get('message', `${currentUserId}_messages`) || [])
                if (!Array.isArray(fallbackRev) || fallbackRev.length === 0) {
                  // nothing to do
                } else {
                  const cleanedRev = fallbackRev.filter(m => !(m && m.id === messageId))
                  if (cleanedRev.length !== fallbackRev.length) {
                    apiManager.setCache(reverseMessageKey, cleanedRev)
                  }
                }
              } else if (cachedRev.length > 0) {
                const cleanedRev = cachedRev.filter(m => !(m && m.id === messageId))
                if (cleanedRev.length !== cachedRev.length) {
                  apiManager.setCache(reverseMessageKey, cleanedRev)
                }
              }
            } catch (e) {
              if (__DEV__) console.warn('⚠️ [NSFW_VIEW] Failed to clean cache for key', reverseMessageKey, e)
            }

            // Update conversation caches to reflect read/viewed NSFW message
            try {
              await realtimeCacheManager.updateConversationCacheWithReadStatus(messageId, messageData.sender_id, currentUserId, Date.now())
            } catch (e) {
              if (__DEV__) console.warn('⚠️ [NSFW_VIEW] Failed to update conversation read status:', e)
            }

            if (__DEV__) console.log('✅ [NSFW_VIEW] Per-message cache cleaned after NSFW completion')
          } catch (cacheError) {
            console.error('❌ [NSFW_VIEW] Cache update error:', cacheError)
          }
        }
      } catch (error) {
        console.error('❌ [NSFW_VIEW] Failed to update database:', error)
      }
    }
  }

  /**
   * Check if a message has been viewed and should be filtered out
   * @param {string} messageId - The message ID
   * @returns {boolean} - True if message should be filtered out
   */
  isViewed(messageId) {
    return this.viewedMessages.has(messageId)
  }

  /**
   * Mark a message as viewed locally (used when receiving realtime events on the sender device)
   * Idempotent: safe to call multiple times. Persists to storage.
   */
  async markAsViewed(messageId) {
    if (!messageId || this.viewedMessages.has(messageId)) return false
    await this.init()
    this.viewedMessages.add(messageId)
    await this.persistViewedMessages()
    if (__DEV__) console.log('🔄 [NSFW_VIEW] Locally marked as viewed via realtime:', messageId)
    return true
  }

  /**
   * Sync NSFW service with database state - mark messages as viewed if they're seen in DB
   * This ensures consistency between database state and service state
   */
  async syncWithDatabase(messages = []) {
    await this.init()
    
    // Check each NSFW message to see if it's marked as seen in database
    let hasChanges = false
    for (const message of messages) {
      if (message.is_nsfw && message.seen && !this.viewedMessages.has(message.id)) {
        // Message is marked as seen in database but not in service - sync it
        this.viewedMessages.add(message.id)
        hasChanges = true
        if (__DEV__) console.log('🔄 [NSFW_VIEW] Synced viewed message from database:', message.id)
      }
    }
    
    // Persist changes if any
    if (hasChanges) {
      await this.persistViewedMessages()
      if (__DEV__) console.log('💾 [NSFW_VIEW] Persisted synced viewed messages')
    }
  }

  /**
   * Check if a message is currently being viewed with timer
   * @param {string} messageId - The message ID
   * @returns {boolean} - True if currently viewing
   */
  isCurrentlyViewing(messageId) {
    return this.currentlyViewing.has(messageId)
  }

  /**
   * Get progress for currently viewing message
   * @param {string} messageId - The message ID
   * @returns {number} - Progress from 0 to 1, or -1 if not viewing
   */
  getProgress(messageId) {
    const session = this.currentlyViewing.get(messageId)
    if (!session) return -1
    
    const elapsed = Date.now() - session.startTime
    return Math.min(elapsed / session.duration, 1)
  }

  /**
   * Clean up all timers (call on app backgrounding)
   */
  cleanup() {
    if (__DEV__) console.log('🧹 [NSFW_VIEW] Cleaning up all timers')
    
    for (const [messageId, session] of this.currentlyViewing) {
      if (session.timer) {
        clearTimeout(session.timer)
      }
      if (session.progressInterval) {
        clearInterval(session.progressInterval)
      }
    }
    
    this.currentlyViewing.clear()
    this.pausedTimers.clear()
    
    // OPTIMIZATION: Clean up AppState listener
    if (this.appStateListener) {
      this.appStateListener.remove()
      this.appStateListener = null
    }
  }

  /**
   * Reset service (for testing or user logout)
   */
  async reset() {
    this.cleanup()
    this.viewedMessages.clear()
    try {
      await AsyncStorage.removeItem(this.storageKey)
      if (__DEV__) console.log('🔄 [NSFW_VIEW] Service reset complete')
    } catch (error) {
      console.error('❌ [NSFW_VIEW] Failed to reset storage:', error)
    }
  }
}

// Export singleton instance
export const nsfwViewService = new NSFWViewService()

// Debug utility for development
if (__DEV__) {
  global.nsfwDebug = {
    logState: () => {
      console.log('🔍 [NSFW_DEBUG] Current state:', {
        viewedCount: nsfwViewService.viewedMessages.size,
        currentlyViewingCount: nsfwViewService.currentlyViewing.size,
        viewedMessages: Array.from(nsfwViewService.viewedMessages),
        currentlyViewing: Array.from(nsfwViewService.currentlyViewing.keys())
      })
    },
    clearAll: async () => {
      await nsfwViewService.reset()
      console.log('🗑️ [NSFW_DEBUG] All NSFW view data cleared')
    },
    isViewed: (messageId) => {
      const viewed = nsfwViewService.isViewed(messageId)
      console.log(`🔍 [NSFW_DEBUG] Message ${messageId} viewed: ${viewed}`)
      return viewed
    }
  }
}
