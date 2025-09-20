/**
 * Notification Integration Service
 * Integrates push notifications with the existing real-time message system
 */

import { AppState } from 'react-native'
import { pushNotificationService, NotificationTypes } from './pushNotificationService'
import { realtimeCacheManager } from './realtimeCacheManager'

class NotificationIntegrationService {
  constructor() {
    this.isInitialized = false
    this.currentUser = null
    this.appState = AppState.currentState
    this.messageBuffer = new Map() // Buffer messages for grouping
    this.bufferTimeout = null
    this.bufferDelay = 2000 // 2 seconds to group messages
    this.sentImmediateNotifications = new Set() // Track messages that already got immediate notifications
    this.immediateNotificationTimeout = null
  }

  // Initialize the integration service with robust error handling
  async init(currentUser, retryCount = 0) {
    const maxRetries = 3
    
    if (this.isInitialized && this.currentUser?.id === currentUser?.id) {
      console.log('📱 [NOTIF_INTEGRATION] Already initialized for this user')
      return
    }

    // Clean up previous initialization if switching users
    if (this.isInitialized && this.currentUser?.id !== currentUser?.id) {
      console.log('📱 [NOTIF_INTEGRATION] Switching users, cleaning up previous initialization')
      await this.cleanup()
    }

    this.currentUser = currentUser
    
    try {
      console.log(`🚀 [NOTIF_INTEGRATION] Initializing notification integration... (attempt ${retryCount + 1}/${maxRetries + 1})`)

      // Initialize push notification service with robust retry
      const pushToken = await pushNotificationService.init(currentUser.id)

      // Set up real-time message listeners
      this.setupRealtimeListeners()

      // Set up app state listeners
      this.setupAppStateListeners()

      // Set up navigation handlers
      this.setupNavigationHandlers()

      // Verify notification system is working
      await this.verifyNotificationSystem()

      this.isInitialized = true
      console.log('✅ [NOTIF_INTEGRATION] Notification integration initialized successfully')

    } catch (error) {
      console.error(`❌ [NOTIF_INTEGRATION] Failed to initialize (attempt ${retryCount + 1}):`, error)
      
      if (retryCount < maxRetries) {
        console.log(`📱 [NOTIF_INTEGRATION] Retrying initialization in 3s... (${retryCount + 1}/${maxRetries})`)
        await new Promise(resolve => setTimeout(resolve, 3000))
        return this.init(currentUser, retryCount + 1)
      }
      
      // Partial initialization - at least set up what we can
      console.log('📱 [NOTIF_INTEGRATION] Setting up basic integration without full push support')
      this.setupRealtimeListeners()
      this.setupAppStateListeners()
      this.setupNavigationHandlers()
      this.isInitialized = true
    }
  }

  // Verify that the notification system is working properly
  async verifyNotificationSystem() {
    try {
      // Check push token
      const pushToken = pushNotificationService.getPushToken()
      if (!pushToken) {
        console.warn('⚠️ [NOTIF_INTEGRATION] No push token available')
      }

      // Check permissions
      const permissionStatus = await pushNotificationService.getPermissionStatus()
      if (permissionStatus !== 'granted') {
        console.warn('⚠️ [NOTIF_INTEGRATION] Push permissions not granted:', permissionStatus)
      }

      console.log('✅ [NOTIF_INTEGRATION] Notification system verification completed')
    } catch (error) {
      console.error('❌ [NOTIF_INTEGRATION] Notification system verification failed:', error)
    }
  }

  // Set up real-time message listeners
  setupRealtimeListeners() {
    // Listen for new messages
    realtimeCacheManager.on('messageReceived', (eventData) => {
      this.handleNewMessage(eventData)
    })

    // Listen for message status updates
    realtimeCacheManager.on('messageRead', (eventData) => {
      this.handleMessageRead(eventData)
    })

    console.log('✅ [NOTIF_INTEGRATION] Real-time listeners set up')
  }

  // Set up app state listeners to track background/foreground state
  setupAppStateListeners() {
    this.appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      console.log(`📱 [NOTIF_INTEGRATION] App state changed: ${this.appState} -> ${nextAppState}`)
      
      const wasBackground = this.appState === 'background' || this.appState === 'inactive'
      const isNowActive = nextAppState === 'active'
      
      this.appState = nextAppState

      if (wasBackground && isNowActive) {
        // App came back to foreground - clear notifications
        this.handleAppForeground()
      }
    })
  }

  // Set up navigation handlers for when user taps notifications
  setupNavigationHandlers() {
    // Handler for app opening from notifications (simplified approach)
    pushNotificationService.on('openApp', (data) => {
      try {
        console.log('📱 [NOTIF_INTEGRATION] Received openApp event:', data)
        this.handleAppOpenFromNotification(data)
      } catch (error) {
        console.error('❌ [NOTIF_INTEGRATION] Error in openApp handler:', error)
      }
    })

    // Keep legacy handlers for backward compatibility but redirect to simplified flow
    pushNotificationService.on('directNavigateToChat', (data) => {
      try {
        console.log('📱 [NOTIF_INTEGRATION] Redirecting directNavigateToChat to simplified app open flow')
        this.handleAppOpenFromNotification({
          ...data,
          hasNewMessage: true
        })
      } catch (error) {
        console.error('❌ [NOTIF_INTEGRATION] Error in directNavigateToChat handler:', error)
      }
    })

    pushNotificationService.on('navigateToChat', (data) => {
      try {
        console.log('📱 [NOTIF_INTEGRATION] Redirecting legacy navigateToChat to simplified app open flow')
        this.handleAppOpenFromNotification({
          ...data,
          hasNewMessage: true
        })
      } catch (error) {
        console.error('❌ [NOTIF_INTEGRATION] Error in navigateToChat handler:', error)
      }
    })

    pushNotificationService.on('notificationTapped', (data) => {
      console.log('📱 [NOTIF_INTEGRATION] Notification tapped event received')
      // Clear notifications handled by the tap handler itself
    })
  }

  // Handle new message received via real-time
  handleNewMessage(eventData) {
    const message = eventData.message || eventData.data
    
    if (!message || !this.currentUser) {
      return
    }

    // Don't send notification for own messages
    if (message.sender_id === this.currentUser.id) {
      return
    }

    console.log(`📱 [NOTIF_INTEGRATION] Processing message ${message.id} from ${message.sender_pseudo || 'unknown'}`)

    // Check if this message already got an immediate notification
    if (this.sentImmediateNotifications.has(message.id)) {
      console.log(`📱 [NOTIF_INTEGRATION] Message ${message.id} already has immediate notification, skipping duplicate notification`)
      return
    }

    // Only send notification if app is in background or message is from different user than current chat
    const shouldSendNotif = this.shouldSendNotification(message)
    
    if (!shouldSendNotif) {
      console.log(`📱 [NOTIF_INTEGRATION] Skipping notification (app active or in chat with sender): ${message.id}`)
      return
    }

    console.log(`📱 [NOTIF_INTEGRATION] Should send notification for message: ${message.id}`)
    
    // Skip real-time notifications entirely - let backgroundMessageService handle all notifications
    console.log(`📱 [NOTIF_INTEGRATION] Skipping real-time notification - backgroundMessageService will handle it`)
  }

  // Mark that a message received an immediate notification (called by backgroundMessageService)
  markImmediateNotificationSent(messageId, senderPseudo) {
    this.sentImmediateNotifications.add(messageId)
    
    // Clean up old entries after 2 minutes to prevent memory leaks (increased from 30s for better race condition handling)
    if (this.immediateNotificationTimeout) {
      clearTimeout(this.immediateNotificationTimeout)
    }
    
    this.immediateNotificationTimeout = setTimeout(() => {
      this.sentImmediateNotifications.clear()
    }, 120000) // 2 minutes instead of 30 seconds
    
    console.log(`📱 [NOTIF_INTEGRATION] Marked immediate notification sent for message: ${messageId} by ${senderPseudo}`)
  }

  // Buffer messages to group notifications from the same sender
  bufferMessage(message) {
    const senderId = message.sender_id
    
    if (!this.messageBuffer.has(senderId)) {
      this.messageBuffer.set(senderId, {
        messages: [],
        senderPseudo: message.sender_pseudo || message.sender?.pseudo || 'Quelqu\'un',
        firstMessageTime: Date.now(),
        hasImmediateNotification: false
      })
    }

    const buffer = this.messageBuffer.get(senderId)
    buffer.messages.push(message)

    // Clear existing timeout
    if (this.bufferTimeout) {
      clearTimeout(this.bufferTimeout)
    }

    // Set new timeout to send grouped notification
    this.bufferTimeout = setTimeout(() => {
      this.sendGroupedNotifications()
    }, this.bufferDelay)
  }

  // Send grouped notifications
  async sendGroupedNotifications() {
    if (this.messageBuffer.size === 0) return

    console.log(`📱 [NOTIF_INTEGRATION] Sending ${this.messageBuffer.size} grouped notifications`)

    for (const [senderId, buffer] of this.messageBuffer.entries()) {
      await this.sendNotificationForSender(senderId, buffer)
    }

    // Clear buffer
    this.messageBuffer.clear()
    this.bufferTimeout = null
  }

  // Send notification for a specific sender with enhanced message info
  async sendNotificationForSender(senderId, buffer) {
    const { messages, senderPseudo } = buffer
    const messageCount = messages.length
    
    let title, body
    
    if (messageCount === 1) {
      title = senderPseudo || 'Nouveau message'
      body = this.getMessagePreview(messages[0])
    } else {
      title = senderPseudo || 'Nouveaux messages'
      body = `${messageCount} nouveaux messages`
    }

    // Enhanced notification data for better navigation
    const notificationData = {
      type: NotificationTypes.MESSAGE,
      senderId,
      senderPseudo: senderPseudo || 'Inconnu',
      messageCount,
      messageIds: messages.map(m => m.id),
      latestMessageAt: messages[messages.length - 1].created_at,
      // Add navigation data
      chatUserId: senderId,
      chatUserPseudo: senderPseudo || 'Inconnu',
      timestamp: Date.now(),
      isGroupedNotification: true,
      // Add media type information for proper handling
      latestMessage: {
        id: messages[messages.length - 1].id,
        mediaType: messages[messages.length - 1].media_type,
        isNsfw: messages[messages.length - 1].is_nsfw === true,
        isOneTime: messages[messages.length - 1].view_once === true,
        hasCaption: !!(messages[messages.length - 1].caption && messages[messages.length - 1].caption.trim())
      },
      // For FCM compatibility
      messageId: messages[messages.length - 1].id,
      mediaType: messages[messages.length - 1].media_type,
      isNsfw: String(messages[messages.length - 1].is_nsfw === true),
      isOneTime: String(messages[messages.length - 1].view_once === true)
    }

    // Send notification
    await pushNotificationService.queueNotification({
      userId: this.currentUser.id,
      title,
      body,
      data: notificationData,
      priority: 'high',
      sound: true
    })

    console.log(`📱 [NOTIF_INTEGRATION] Notification sent for ${senderPseudo} (${messageCount} messages)`)
  }

  // Get preview text for a message with enhanced media type indicators
  getMessagePreview(message) {
    if (message.caption && message.caption.trim()) {
      const caption = message.caption.length > 100 
        ? message.caption.substring(0, 100) + '...'
        : message.caption
      
      // Add media type indicator even with caption
      const mediaIndicator = this.getMediaTypeIndicator(message)
      return `${mediaIndicator} ${caption}`
    }

    // Generate preview based on media type with enhanced indicators
    return this.getMediaTypeIndicator(message)
  }

  // Get media type indicator with NSFW/one-time/permanent information
  getMediaTypeIndicator(message) {
    const isNsfw = message.is_nsfw === true
    const isOneTime = message.view_once === true
    const mediaType = message.media_type || 'message'
    
    // Base media indicators
    let baseIndicator = ''
    switch (mediaType) {
      case 'photo':
      case 'image':
        baseIndicator = '📷 Photo'
        break
      case 'video':
        baseIndicator = '🎥 Vidéo'
        break
      default:
        baseIndicator = '💬 Message'
        break
    }
    
    // Add special type indicators
    const indicators = []
    
    if (isOneTime) {
      indicators.push('🔥 Vue unique')
    } else {
      indicators.push('� Permanent')
    }
    
    if (isNsfw) {
      indicators.push('🔞 NSFW')
    }
    
    // Combine base indicator with special indicators
    if (indicators.length > 0) {
      return `${baseIndicator} (${indicators.join(', ')})`
    }
    
    return baseIndicator
  }

  // Determine if notification should be sent
  shouldSendNotification(message) {
    // Always send if app is in background
    if (this.appState === 'background' || this.appState === 'inactive') {
      return true
    }

    // If app is active, only send if not currently viewing chat with sender
    const currentChatUserId = pushNotificationService.currentChatUserId
    return currentChatUserId !== message.sender_id
  }

  // Handle message read events
  handleMessageRead(eventData) {
    // Update badge count when messages are read
    this.updateBadgeCount()
  }

  // Handle app coming to foreground
  handleAppForeground() {
    console.log('📱 [NOTIF_INTEGRATION] App came to foreground - clearing notifications')
    
    // Clear all notifications when app becomes active
    pushNotificationService.clearAllNotifications()
    
    // Update badge count
    this.updateBadgeCount()
  }

  // Simplified app open handler - always opens to home screen and properly initializes everything
  async handleAppOpenFromNotification(data) {
    const { senderId, senderPseudo, timestamp, source, hasNewMessage } = data
    
    console.log('📱 [NOTIF_INTEGRATION] App opened from notification - simplified flow', {
      senderId,
      senderPseudo,
      hasNewMessage,
      source
    })
    
    // Debounce protection
    if (this.lastAppOpenTime && timestamp - this.lastAppOpenTime < 1000) {
      console.log('📱 [NOTIF_INTEGRATION] Ignoring duplicate app open')
      return
    }
    this.lastAppOpenTime = timestamp

    try {
      // Clear all notifications immediately
      console.log('📱 [NOTIF_INTEGRATION] Clearing all notifications')
      pushNotificationService.clearAllNotifications()
      
      // Ensure app is properly initialized
      console.log('📱 [NOTIF_INTEGRATION] Ensuring app initialization...')
      await this.ensureAppInitialized()
      
      // Force refresh data for latest state
      console.log('📱 [NOTIF_INTEGRATION] Refreshing app data...')
      const { apiManager } = await import('./apiManager')
      
      // Clear caches to ensure fresh data
      apiManager.clearCache()
      
      // Pre-load conversations to ensure fresh data on home screen
      if (this.currentUser?.id) {
        console.log('📱 [NOTIF_INTEGRATION] Pre-loading fresh conversation data...')
        try {
          await apiManager.refreshConversations(this.currentUser.id)
          console.log('✅ [NOTIF_INTEGRATION] Fresh conversation data loaded')
        } catch (error) {
          console.warn('⚠️ [NOTIF_INTEGRATION] Failed to pre-load conversations:', error)
        }
      }

      // Clear notifications for sender if specified
      if (senderId) {
        await this.clearNotificationsForConversation(senderId)
      }

      // Emit event to refresh home screen and ensure proper state
      realtimeCacheManager.emit('appOpenedFromNotification', {
        senderId,
        senderPseudo,
        timestamp,
        source,
        hasNewMessage,
        forceRefresh: true
      })

      // COLD START FIX: Add a backup refresh after a short delay to ensure UI updates
      setTimeout(() => {
        console.log('📱 [NOTIF_INTEGRATION] Backup refresh for cold start')
        realtimeCacheManager.emit('appReturnedFromBackground', {
          timestamp: Date.now(),
          source: 'notification_cold_start_backup',
          forceRefresh: true
        })
      }, 1000)

      console.log('✅ [NOTIF_INTEGRATION] App opened successfully - user can navigate to conversations from home screen')
      
    } catch (error) {
      console.error('❌ [NOTIF_INTEGRATION] Error opening app from notification:', error)
      
      // Fallback: still emit the event to refresh home screen
      try {
        realtimeCacheManager.emit('appOpenedFromNotification', {
          senderId,
          senderPseudo,
          timestamp,
          source,
          hasNewMessage: true,
          fallback: true
        })
        console.log('🔄 [NOTIF_INTEGRATION] Fallback app open emitted')
      } catch (fallbackError) {
        console.error('❌ [NOTIF_INTEGRATION] Fallback app open also failed:', fallbackError)
      }
    }
  }

  // Direct navigation handler for production-ready notification taps
  async handleDirectNavigateToChat(data) {
    const { senderId, senderPseudo, timestamp, source, messageId, isNsfw, isOneTime, mediaType } = data
    
    console.log(`📱 [NOTIF_INTEGRATION] Direct navigate to chat: ${senderPseudo} (${senderId}) from ${source}`, {
      messageId,
      isNsfw,
      isOneTime,
      mediaType
    })
    
    // Debounce protection at integration level
    if (this.lastDirectNavigation && timestamp - this.lastDirectNavigation < 1000) {
      console.log('📱 [NOTIF_INTEGRATION] Ignoring duplicate direct navigation')
      return
    }
    this.lastDirectNavigation = timestamp

    try {
      // Ensure app is properly initialized before navigation
      console.log('📱 [NOTIF_INTEGRATION] Ensuring app initialization before navigation...')
      await this.ensureAppInitialized()
      
      // Force refresh data before navigation for latest state
      console.log('📱 [NOTIF_INTEGRATION] Force refreshing data before navigation...')
      const { apiManager } = await import('./apiManager')
      
      // Clear caches to ensure fresh data
      apiManager.clearCache()
      
      // Pre-load conversation data to ensure smooth navigation
      if (this.currentUser?.id) {
        console.log('📱 [NOTIF_INTEGRATION] Pre-loading conversation data...')
        try {
          await apiManager.getConversations(this.currentUser.id, { forceRefresh: true })
          console.log('✅ [NOTIF_INTEGRATION] Conversation data pre-loaded')
        } catch (error) {
          console.warn('⚠️ [NOTIF_INTEGRATION] Failed to pre-load conversations, continuing anyway:', error)
        }
      }
      
      // Clear notifications for this conversation
      await this.clearNotificationsForConversation(senderId)

      // Immediate navigation without delays
      realtimeCacheManager.emit('directNavigateToChat', {
        senderId,
        senderPseudo,
        timestamp,
        source,
        immediate: true,
        forceRefresh: true,
        // Pass media type information for proper handling
        messageId,
        isNsfw,
        isOneTime,
        mediaType
      })

      console.log(`✅ [NOTIF_INTEGRATION] Direct navigation emitted successfully`)
      
    } catch (error) {
      console.error('❌ [NOTIF_INTEGRATION] Error in direct navigation:', error)
      
      // Fallback: emit navigation anyway to prevent user from being stuck
      try {
        realtimeCacheManager.emit('directNavigateToChat', {
          senderId,
          senderPseudo,
          timestamp,
          source,
          immediate: true,
          fallback: true,
          // Include media info in fallback too
          messageId,
          isNsfw,
          isOneTime,
          mediaType
        })
        console.log('🔄 [NOTIF_INTEGRATION] Fallback navigation emitted')
      } catch (fallbackError) {
        console.error('❌ [NOTIF_INTEGRATION] Fallback navigation also failed:', fallbackError)
      }
    }
  }

  // Legacy navigation handler with delays (kept for backward compatibility)
  async handleNavigateToChat(data) {
    console.log('⚠️ [NOTIF_INTEGRATION] Using legacy navigation handler - consider updating to directNavigateToChat')
    return this.handleDirectNavigateToChat(data)
  }

  // Ensure app services are properly initialized
  async ensureAppInitialized() {
    console.log('📱 [NOTIF_INTEGRATION] Ensuring app is initialized...')
    
    // Wait for core services to be ready
    const maxWait = 3000 // 3 seconds max
    const startTime = Date.now()
    
    while (Date.now() - startTime < maxWait) {
      try {
        // Check if apiManager is initialized
        const { apiManager } = await import('./apiManager')
        if (apiManager && apiManager.isInitialized) {
          
          // Check if realtimeService is ready
          const { realtimeService } = await import('./realtimeService')
          if (realtimeService && realtimeService.isConnected) {
            console.log('✅ [NOTIF_INTEGRATION] App services are ready')
            return true
          }
        }
        
        // Wait 100ms before checking again
        await new Promise(resolve => setTimeout(resolve, 100))
        
      } catch (error) {
        // Services might not be imported yet, continue waiting
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
    
    console.log('⚠️ [NOTIF_INTEGRATION] App initialization timeout, proceeding anyway')
    return false
  }

  // Preload recent media for the chat
  async preloadChatMedia(senderId) {
    console.log(`📱 [NOTIF_INTEGRATION] Preloading media for chat with ${senderId}`)
    
    try {
      // Import services dynamically to avoid circular dependencies
      const { apiManager } = await import('./apiManager')
      const { unifiedMediaService } = await import('./unifiedMediaService')
      
      // Get recent messages for this chat (last 5 messages)
      const cacheKey = `conversation:${senderId}`
      const cachedMessages = apiManager.cache.get(cacheKey)
      
      if (cachedMessages?.data?.messages) {
        const recentMessages = cachedMessages.data.messages.slice(-5)
        const mediaUrls = []
        
        // Collect media URLs from recent messages
        for (const message of recentMessages) {
          if (message.media_url) {
            mediaUrls.push(message.media_url)
          }
        }
        
        // ❌ Ne plus précharger depuis la notification
        // La notification ne doit jamais déclencher un download proactif.
        console.log(`📱 [NOTIF_INTEGRATION] Found ${mediaUrls.length} media items - will load on demand`)
        
        // Continue without preloading to save egress
        console.log(`✅ [NOTIF_INTEGRATION] Skipped media preloading for ${senderId} to save egress`)
      } else {
        console.log(`📱 [NOTIF_INTEGRATION] No cached messages found for ${senderId}`)
      }
      
    } catch (error) {
      console.error('❌ [NOTIF_INTEGRATION] Error preloading chat media:', error)
      // Non-critical error, don't throw
    }
  }

  // Update badge count based on unread messages
  async updateBadgeCount() {
    try {
      // This would ideally come from your message cache or database
      // For now, we'll use a simplified approach
      const unreadCount = await this.getUnreadMessageCount()
      await pushNotificationService.updateBadgeCount(unreadCount)
    } catch (error) {
      console.error('❌ [NOTIF_INTEGRATION] Error updating badge count:', error)
    }
  }

  // Get unread message count
  async getUnreadMessageCount() {
    // This is a placeholder - implement based on your message system
    // You might want to query the database or use cached data
    return 0
  }

  // Set current chat user (called by chat screen)
  setCurrentChatUser(userId) {
    pushNotificationService.setCurrentChatUser(userId)
    
    // Also update the chat visibility service for consistency
    try {
      import('./chatVisibilityService').then(({ chatVisibilityService }) => {
        if (userId) {
          chatVisibilityService.setChatVisible(userId)
        } else {
          chatVisibilityService.setChatHidden()
        }
      })
    } catch (error) {
      console.error('❌ [NOTIF_INTEGRATION] Error updating chat visibility:', error)
    }
    
    console.log(`📱 [NOTIF_INTEGRATION] Current chat user: ${userId || 'none'}`)
  }

  // Clear notifications for a specific conversation
  async clearNotificationsForConversation(senderId) {
    try {
      console.log(`🔔 [NOTIF_INTEGRATION] Clearing notifications for conversation with ${senderId}`)
      
      // Clear pending notifications via pushNotificationService
      await pushNotificationService.clearNotificationsForSender(senderId)
      
      // Remove from message buffer
      const messagesToRemove = []
      for (const [messageId, messageData] of this.messageBuffer.entries()) {
        if (messageData.senderId === senderId) {
          messagesToRemove.push(messageId)
        }
      }
      
      messagesToRemove.forEach(messageId => {
        this.messageBuffer.delete(messageId)
        console.log(`🔔 [NOTIF_INTEGRATION] Removed message ${messageId} from buffer`)
      })
      
      // Clear from immediate notifications tracking
      for (const messageId of this.sentImmediateNotifications) {
        // We can't easily determine which messages belong to this sender
        // but this set will be cleared on next buffer cycle anyway
      }
      
      console.log(`✅ [NOTIF_INTEGRATION] Cleared notifications for ${senderId}`)
      
    } catch (error) {
      console.error(`❌ [NOTIF_INTEGRATION] Error clearing notifications for ${senderId}:`, error)
    }
  }

  // Handle user logout
  async cleanup() {
    try {
      console.log('📱 [NOTIF_INTEGRATION] Cleaning up notification integration...')

      // Remove app state listener
      if (this.appStateSubscription) {
        this.appStateSubscription.remove()
        this.appStateSubscription = null
      }

      // Clear buffer timeout
      if (this.bufferTimeout) {
        clearTimeout(this.bufferTimeout)
        this.bufferTimeout = null
      }

      // Clear immediate notification timeout
      if (this.immediateNotificationTimeout) {
        clearTimeout(this.immediateNotificationTimeout)
        this.immediateNotificationTimeout = null
      }

      // Clear message buffer
      this.messageBuffer.clear()
      this.sentImmediateNotifications.clear()

      // Cleanup push notification service
      await pushNotificationService.cleanup()

      // Reset state
      this.isInitialized = false
      this.currentUser = null

      console.log('✅ [NOTIF_INTEGRATION] Cleanup completed')

    } catch (error) {
      console.error('❌ [NOTIF_INTEGRATION] Error during cleanup:', error)
    }
  }

  // Update notification settings
  async updateNotificationSettings(settings) {
    await pushNotificationService.updateSettings(settings)
    console.log('📱 [NOTIF_INTEGRATION] Settings updated:', settings)
  }

  // Get notification settings
  getNotificationSettings() {
    return pushNotificationService.settings || {}
  }

  // Test notification (for debugging)
  async sendTestNotification() {
    if (!this.currentUser) {
      console.error('❌ [NOTIF_INTEGRATION] No current user for test notification')
      return
    }

    await pushNotificationService.queueNotification({
      userId: this.currentUser.id,
      title: 'Test NoText',
      body: 'Ceci est une notification de test !',
      data: {
        type: 'test',
        timestamp: Date.now()
      },
      priority: 'high'
    })

    console.log('📱 [NOTIF_INTEGRATION] Test notification sent')
  }
}

// Export singleton instance
// Export singleton instance
export const notificationIntegration = new NotificationIntegrationService()
export const notificationIntegrationService = notificationIntegration

// Also export the class for potential future use
export { NotificationIntegrationService }
