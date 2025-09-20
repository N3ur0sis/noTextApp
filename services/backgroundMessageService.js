/**
 * Background Message Service
 * Handles optimistic message sending with queue management and background upload
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState } from 'react-native'
import { sendMessage } from './userService'
import { realtimeCacheManager } from './realtimeCacheManager'
import { uploadMedia } from './unifiedMediaService'

class BackgroundMessageService {
  constructor() {
    this.queue = []
    this.isProcessing = false
    this.listeners = new Map()
    this.pendingMessages = new Map() // messageId -> message data
    this.appState = AppState.currentState
    this.appStateSubscription = null
    this.isBackgroundMode = false
    this.backgroundTaskId = null
    this.setupAppStateHandling()
  }

  // Setup AppState handling for background processing
  setupAppStateHandling() {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove()
    }

    this.appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      console.log(`📱 [BG_MSG] App state changed: ${this.appState} -> ${nextAppState}`)
      
      const wasBackground = this.appState === 'background' || this.appState === 'inactive'
      const isNowActive = nextAppState === 'active'
      const isGoingBackground = nextAppState === 'background' || nextAppState === 'inactive'

      this.appState = nextAppState
      this.isBackgroundMode = isGoingBackground

      if (isNowActive && wasBackground) {
        console.log('📱 [BG_MSG] App came to foreground - resuming queue processing')
        this.processQueue() // Resume processing when returning to foreground
      } else if (isGoingBackground) {
        console.log('📱 [BG_MSG] App going to background - ensuring queue continues')
        this.ensureBackgroundProcessing()
      }
    })
  }

  // Ensure processing continues in background
  async ensureBackgroundProcessing() {
    if (this.queue.length > 0 && !this.isProcessing) {
      console.log(`📱 [BG_MSG] Starting background processing for ${this.queue.length} messages`)
      // Don't wait for this to complete - let it run in background
      this.processQueue().catch(error => {
        console.error('❌ [BG_MSG] Background processing error:', error)
      })
    }
  }

  // Add event listener
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event).push(callback)
  }

  // Remove event listener
  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event)
      const index = callbacks.indexOf(callback)
      if (index > -1) {
        callbacks.splice(index, 1)
      }
    }
  }

  // Emit event
  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => {
        try {
          callback(data)
        } catch (error) {
          console.error('❌ [BG_MSG] Event callback error:', error)
        }
      })
    }
  }

  // Generate temporary ID for optimistic messages
  generateTempId() {
    return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  // Add message to background sending queue with optimistic UI (includes upload)
  async queueMessage({
    receiverId,
    localMediaUri, // Local file URI - will be uploaded in background
    mediaType,
    caption = null,
    mediaMode = 'permanent',
    isMuted = false,
    currentUser,
    otherUser
  }) {
    const tempId = this.generateTempId()
    const timestamp = new Date().toISOString()

    // Create optimistic message object using local media URI
    const optimisticMessage = {
      id: tempId,
      sender_id: currentUser.id,
      receiver_id: receiverId,
      media_url: localMediaUri, // Use local file initially
      media_type: mediaType,
      caption,
      view_once: mediaMode === 'one_time',
      is_nsfw: mediaMode === 'nsfw',
      is_muted: isMuted,
      created_at: timestamp,
      seen: false,
      read: false,
      // Add sending indicator
      _isSending: true,
      _tempId: tempId
    }

    console.log(`📤 [BG_MSG] Queueing message for background upload & send:`, {
      tempId,
      receiverId,
      mediaType,
      mediaMode,
      localMediaUri: localMediaUri?.substring(localMediaUri.lastIndexOf('/') + 1)
    })

    // Add to pending messages
    this.pendingMessages.set(tempId, optimisticMessage)

    // Add to queue for actual upload and sending
    const queueItem = {
      tempId,
      receiverId,
      localMediaUri,
      mediaType,
      caption,
      mediaMode,
      isMuted,
      currentUser,
      otherUser,
      timestamp,
      retries: 0,
      maxRetries: 3
    }

    this.queue.push(queueItem)

    // Immediately add optimistic message to cache for instant UI
    try {
      realtimeCacheManager.addOptimisticMessage(optimisticMessage, receiverId)
      
      // Emit event for immediate UI updates
      this.emit('optimisticMessageAdded', {
        message: optimisticMessage,
        receiverId
      })

      console.log(`✅ [BG_MSG] Optimistic message added to UI: ${tempId}`)
    } catch (error) {
      console.error('❌ [BG_MSG] Error adding optimistic message:', error)
    }

    // Start processing queue
    this.processQueue()

    // Persist queue to storage
    this.persistQueue()

    return tempId
  }

  // Enhanced message queue processing with prioritized UI updates
  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return
    }

    this.isProcessing = true
    console.log(`🔄 [BG_MSG] Processing queue with ${this.queue.length} messages`)
    
    // Immediately notify UI about queue processing for better user feedback
    this.emit('queueProcessingStarted', {
      queueSize: this.queue.length,
      timestamp: Date.now()
    })

    while (this.queue.length > 0) {
      const item = this.queue[0] // Process first item
      
      try {
        console.log(`📤 [BG_MSG] Processing message ${item.tempId}...`)
        
        // Update sending status
        this.updateMessageStatus(item.tempId, 'uploading')

        // Step 1: Upload media in background
        console.log(`📤 [BG_MSG] Uploading media for ${item.tempId}...`)
        const uploadResult = await uploadMedia(
          item.localMediaUri,
          item.mediaType,
          item.currentUser,
          item.otherUser || { pseudo: 'unknown', id: null }
        )

        // Handle the new uploadResult format
        // On force l'usage du schéma interne pour la DB
        const mediaUrl = (uploadResult && uploadResult.mediaUrl) ? uploadResult.mediaUrl : null;           // sb://media/<objectKey>
        const thumbnailUrl = (uploadResult && uploadResult.thumbnailUrl) ? uploadResult.thumbnailUrl : null; // sb://thumbs/<objectKey>
        const localPath = (uploadResult && uploadResult.localPath) ? uploadResult.localPath : null;          // file://… (sender)

        if (!mediaUrl) {
          throw new Error('Upload failed: No media URL returned')
        }

        console.log(`✅ [BG_MSG] Media uploaded for ${item.tempId}: ${uploadResult.objectKey}`)

        // Step 2: Optimistic UI : **ne touchez pas** au media_url local (file://...)
        const updatedOptimisticMessage = {
          ...this.pendingMessages.get(item.tempId),
          // media_url: on garde le file:// initial du sender
          thumbnail_url: this.pendingMessages.get(item.tempId)?.thumbnail_url || thumbnailUrl || null
        }
        this.pendingMessages.set(item.tempId, updatedOptimisticMessage)
        realtimeCacheManager.replaceOptimisticMessage(item.tempId, updatedOptimisticMessage)

        // Step 3: Send message to server
        this.updateMessageStatus(item.tempId, 'sending')
        console.log(`📤 [BG_MSG] Sending message ${item.tempId} to server...`)

        const sentMessage = await sendMessage(
          item.receiverId,
          mediaUrl,
          item.mediaType,
          item.caption,
          item.mediaMode,
          thumbnailUrl,
          item.isMuted
        )

        console.log(`✅ [BG_MSG] Message sent successfully: ${item.tempId} -> ${sentMessage.id}`)

        // Send push notification to receiver with enhanced error handling using notification manager
        try {
          const { notificationManager } = await import('./notificationManager')
          
          // Use the robust notification manager
          await notificationManager.sendNotification({
            userId: item.receiverId,
            title: item.currentUser.pseudo || 'Nouveau message',
            body: item.caption || 'Nouveau média reçu',
            data: {
              type: 'message',
              senderId: item.currentUser.id,
              senderPseudo: item.currentUser.pseudo,
              messageId: sentMessage.id,
              chatUserId: item.currentUser.id,
              chatUserPseudo: item.currentUser.pseudo
            },
            priority: 'high'
          })
          
          console.log(`📱 [BG_MSG] Notification sent via manager for message: ${sentMessage.id}`)
          
          // Mark this message as having received an immediate notification
          const { notificationIntegration } = await import('./notificationIntegration')
          
          if (notificationIntegration.isInitialized) {
            // Just mark the notification as sent, don't trigger another one
            notificationIntegration.markImmediateNotificationSent(sentMessage.id, item.currentUser.pseudo)
            console.log(`📱 [BG_MSG] Marked immediate notification for message: ${sentMessage.id}`)
          }
          
        } catch (notifError) {
          console.error('❌ [BG_MSG] Error sending notification via manager:', notifError)
          
          // Fallback to direct push service
          try {
            const { pushNotificationService } = await import('./pushNotificationService')
            
            await pushNotificationService.queueNotification({
              userId: item.receiverId,
              title: item.currentUser.pseudo || 'Nouveau message',
              body: item.caption || 'Nouveau média reçu',
              data: {
                type: 'message',
                senderId: item.currentUser.id,
                senderPseudo: item.currentUser.pseudo,
                messageId: sentMessage.id,
                chatUserId: item.currentUser.id,
                chatUserPseudo: item.currentUser.pseudo
              },
              priority: 'high',
              sound: true
            })
            
            console.log(`📱 [BG_MSG] Fallback notification sent for message: ${sentMessage.id}`)
            
            // Mark this message as having received an immediate notification
            const { notificationIntegration } = await import('./notificationIntegration')
            if (notificationIntegration.isInitialized) {
              notificationIntegration.markImmediateNotificationSent(sentMessage.id, item.currentUser.pseudo)
            }
          } catch (fallbackError) {
            console.error('❌ [BG_MSG] Fallback notification also failed:', fallbackError)
          }
        }

        // Mark the real message as an optimistic replacement so cache handles it correctly
        const sentMessageWithReplacement = {
          ...sentMessage,
          _tempId: item.tempId, // Mark as optimistic replacement
          _isOptimisticReplacement: true
        }

        // Replace optimistic message with real message
        this.replaceOptimisticMessage(item.tempId, sentMessageWithReplacement)

        // Remove from queue
        this.queue.shift()

        // Update status
        this.updateMessageStatus(item.tempId, 'sent', sentMessageWithReplacement)

      } catch (error) {
        console.error(`❌ [BG_MSG] Error processing message ${item.tempId}:`, error)
        
        item.retries++
        
        if (item.retries >= item.maxRetries) {
          console.error(`💀 [BG_MSG] Message ${item.tempId} failed after ${item.maxRetries} retries`)
          
          // Mark as failed
          this.updateMessageStatus(item.tempId, 'failed', null, error.message)
          
          // Remove from queue
          this.queue.shift()
        } else {
          console.log(`🔄 [BG_MSG] Retrying message ${item.tempId} (${item.retries}/${item.maxRetries})`)
          
          // Move to end of queue for retry
          this.queue.push(this.queue.shift())
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 2000 * item.retries))
        }
      }
    }

    this.isProcessing = false
    console.log(`✅ [BG_MSG] Queue processing complete`)

    // Clear persisted queue
    this.persistQueue()
  }

  // Update message status in UI - ENHANCED
  updateMessageStatus(tempId, status, realMessage = null, error = null) {
    const pendingMessage = this.pendingMessages.get(tempId)
    if (!pendingMessage) {
      console.log(`⚠️ [BG_MSG] No pending message found for tempId: ${tempId}`)
      return
    }

    console.log(`🔄 [BG_MSG] Updating message status: ${tempId} -> ${status}`)

    // Update status and clear sending flags for final states
    pendingMessage._sendingStatus = status
    if (error) pendingMessage._error = error
    
    // For final states, clear the sending flag to prevent UI showing "Envoi..."
    if (status === 'sent' || status === 'failed') {
      pendingMessage._isSending = false
    }

    // Emit status update with enhanced data
    this.emit('messageStatusUpdate', {
      tempId,
      status,
      message: realMessage || pendingMessage,
      error,
      isComplete: status === 'sent' || status === 'failed'
    })

    // For sent messages, trigger immediate replacement if we have real message
    if (status === 'sent' && realMessage) {
      // Small delay to ensure status update is processed first
      setTimeout(() => {
        this.replaceOptimisticMessage(tempId, realMessage)
      }, 50)
    }

    // Clean up if sent or failed - increased delay for better UX
    if (status === 'sent' || status === 'failed') {
      setTimeout(() => {
        const stillExists = this.pendingMessages.has(tempId)
        if (stillExists) {
          console.log(`🧹 [BG_MSG] Cleaning up ${status} message: ${tempId}`)
          this.pendingMessages.delete(tempId)
          
          // Emit cleanup event to ensure UI updates
          this.emit('messageCleanup', {
            tempId,
            status,
            wasReplaced: status === 'sent' && realMessage
          })
        }
      }, status === 'sent' ? 2000 : 5000) // Longer for sent messages to allow replacement
    }
  }

  // Enhanced replacement of optimistic message with real sent message
  replaceOptimisticMessage(tempId, realMessage) {
    try {
      console.log(`🔄 [BG_MSG] Replacing optimistic message: ${tempId} -> ${realMessage.id}`)
      
      // Ensure the real message doesn't have optimistic flags
      const cleanRealMessage = {
        ...realMessage,
        _tempId: tempId, // Keep reference to original tempId for tracking
        _isOptimisticReplacement: true,
        _isSending: false, // Ensure this is not marked as sending
        _sendingStatus: 'sent' // Mark as successfully sent
      };
      
      // Remove optimistic message from pending messages immediately
      this.pendingMessages.delete(tempId)
      
      // Update cache with clean real message using realtimeCacheManager
      realtimeCacheManager.replaceOptimisticMessage(tempId, cleanRealMessage)
      
      // Immediately emit events for UI updates - emit replacement event first
      this.emit('optimisticMessageReplaced', {
        tempId,
        realMessage: cleanRealMessage
      })
      
      // Also emit as if this was a new message received to ensure all UI components update
      setTimeout(() => {
        this.emit('messageReceived', {
          message: cleanRealMessage,
          conversationId: cleanRealMessage.receiver_id
        })
      }, 100); // Small delay to ensure replacement happens first
      
      console.log(`✅ [BG_MSG] Optimistic message replaced with real message: ${tempId} -> ${cleanRealMessage.id}`)
      
    } catch (error) {
      console.error('❌ [BG_MSG] Error replacing optimistic message:', error)
    }
  }

  // Persist queue to storage for app restart recovery
  async persistQueue() {
    try {
      await AsyncStorage.setItem('backgroundMessageQueue', JSON.stringify(this.queue))
    } catch (error) {
      console.error('❌ [BG_MSG] Error persisting queue:', error)
    }
  }

  // Load queue from storage on app start
  async loadQueue() {
    try {
      const stored = await AsyncStorage.getItem('backgroundMessageQueue')
      if (stored) {
        this.queue = JSON.parse(stored)
        console.log(`📥 [BG_MSG] Loaded ${this.queue.length} messages from storage`)
        
        // Process any pending messages
        if (this.queue.length > 0) {
          this.processQueue()
        }
      }
    } catch (error) {
      console.error('❌ [BG_MSG] Error loading queue:', error)
    }
  }

  // Get pending message by temp ID
  getPendingMessage(tempId) {
    return this.pendingMessages.get(tempId)
  }

  // Get all pending messages
  getAllPendingMessages() {
    return Array.from(this.pendingMessages.values())
  }

  // Cancel a pending message
  cancelMessage(tempId) {
    // Remove from queue
    this.queue = this.queue.filter(item => item.tempId !== tempId)
    
    // Remove from pending
    this.pendingMessages.delete(tempId)
    
    // Remove from cache
    realtimeCacheManager.removeOptimisticMessage(tempId)
    
    // Emit cancellation
    this.emit('messageCancelled', { tempId })
    
    // Update storage
    this.persistQueue()
  }

  // Initialize the service
  async init() {
    console.log('🚀 [BG_MSG] Initializing background message service')
    await this.loadQueue()
  }

  // Cleanup method for proper service shutdown
  cleanup() {
    console.log('🧹 [BG_MSG] Cleaning up background message service')
    
    if (this.appStateSubscription) {
      this.appStateSubscription.remove()
      this.appStateSubscription = null
    }

    // Clear all listeners
    this.listeners.clear()
    
    // Don't clear queue/pending messages - they should persist for next session
  }
}

// Export singleton instance
export const backgroundMessageService = new BackgroundMessageService()
