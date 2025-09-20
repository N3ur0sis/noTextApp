/**
 * One-time View Service
 * Manages the viewing state of one-time messages
 * Handles persistence and blur overlay logic
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import { markMessageAsSeen } from './userService'

const ONE_TIME_VIEWED_KEY = 'oneTimeViewedMessages'

class OneTimeViewService {
  constructor() {
    this.viewedMessages = new Set()
    this.currentlyViewing = new Set() // Messages currently being viewed (not yet blurred)
    this.initialized = false
  }

  async init() {
    if (this.initialized) return

    try {
      const stored = await AsyncStorage.getItem(ONE_TIME_VIEWED_KEY)
      if (stored) {
        const viewedArray = JSON.parse(stored)
        this.viewedMessages = new Set(viewedArray)
        console.log('📱 [ONE_TIME_VIEW] Loaded', viewedArray.length, 'viewed messages')
      }
      this.initialized = true
    } catch (error) {
      console.error('❌ [ONE_TIME_VIEW] Failed to load viewed messages:', error)
      this.initialized = true // Continue without stored data
    }
  }

  /**
   * Mark a one-time message as currently being viewed
   * This allows viewing without blur until the user leaves
   * Only applies to messages received by the current user
   */
  async startViewing(messageId, currentUserId = null, message = null) {
    await this.init()
    
    if (!messageId) return false
    
    console.log(`🔄 [ONE_TIME_VIEW] startViewing called for message: ${messageId}`)
    
    // If we have message object, validate this is a received one-time message
    if (message && currentUserId) {
      // Only allow viewing received one-time messages
      if (!message.view_once) {
        console.log(`ℹ️ [ONE_TIME_VIEW] Message ${messageId} is not a one-time message, skipping`)
        return false
      }
      
      if (message.receiver_id !== currentUserId) {
        console.log(`ℹ️ [ONE_TIME_VIEW] Message ${messageId} not received by current user, skipping`)
        return false
      }
      
      if (message.sender_id === currentUserId) {
        console.log(`ℹ️ [ONE_TIME_VIEW] Message ${messageId} was sent by current user, skipping`)
        return false
      }
    }
    
    // Don't start viewing if already permanently viewed
    if (this.viewedMessages.has(messageId)) {
      console.log(`ℹ️ [ONE_TIME_VIEW] Message ${messageId} already permanently viewed, not starting viewing`)
      return false
    }
    
    this.currentlyViewing.add(messageId)
    console.log('👁️ [ONE_TIME_VIEW] Started viewing message (no blur until stopped):', messageId)
    return true
  }

  /**
   * Stop viewing a one-time message and mark it as permanently viewed
   * This triggers the blur overlay for future views and updates the database
   */
  async stopViewing(messageId, currentUserId = null) {
    await this.init()
    
    if (!messageId) {
      console.log('⚠️ [ONE_TIME_VIEW] stopViewing called with no messageId')
      return false
    }
    
    console.log(`🔄 [ONE_TIME_VIEW] stopViewing called for message: ${messageId}, currently viewing: ${this.currentlyViewing.has(messageId)}`)
    
    if (!this.currentlyViewing.has(messageId)) {
      console.log(`ℹ️ [ONE_TIME_VIEW] Message ${messageId} was not currently being viewed, skipping`)
      return false
    }
    
    this.currentlyViewing.delete(messageId)
    
    // Mark as permanently viewed
    if (!this.viewedMessages.has(messageId)) {
      this.viewedMessages.add(messageId)
      await this.persistViewedMessages()
      console.log('🔒 [ONE_TIME_VIEW] Message permanently viewed (will now show blur):', messageId)
      
      // Update database with viewed_at timestamp (don't mark as fully seen yet)
      if (currentUserId) {
        try {
          await markMessageAsSeen(messageId, currentUserId, false) // false = just viewed_at, not fully seen
          console.log('💾 [ONE_TIME_VIEW] Database updated with viewed_at for message:', messageId)
        } catch (error) {
          console.error('❌ [ONE_TIME_VIEW] Failed to update database:', error)
        }
      }
    } else {
      console.log(`ℹ️ [ONE_TIME_VIEW] Message ${messageId} was already permanently viewed`)
    }
    
    return true
  }

  /**
   * Check if a message should show blur overlay
   * Returns true if message has been viewed and is not currently being viewed
   * Only applies to messages received by the current user (senders never see blur)
   */
  shouldShowBlur(messageId, currentUserId = null, message = null) {
    if (!this.initialized || !messageId) return false
    
    // If we have message object, check if current user is the sender
    if (message && currentUserId) {
      // Senders should never see blur on their own messages
      if (message.sender_id === currentUserId) {
        return false
      }
      
      // Only receivers of one-time messages can see blur
      if (!message.view_once || message.receiver_id !== currentUserId) {
        return false
      }
    }
    
    const isViewed = this.viewedMessages.has(messageId)
    const isCurrentlyViewing = this.currentlyViewing.has(messageId)
    
    return isViewed && !isCurrentlyViewing
  }

  /**
   * Check if a message is currently being viewed (first time, no blur)
   */
  isCurrentlyViewing(messageId) {
    return this.currentlyViewing.has(messageId)
  }

  /**
   * Check if a message has been permanently viewed
   */
  isViewed(messageId) {
    return this.viewedMessages.has(messageId)
  }

  /**
   * Sync with database state - mark messages as viewed if they have viewed_at in database
   * This handles messages viewed on other devices or sessions
   */
  async syncWithDatabase(messages, currentUserId) {
    if (!messages || !currentUserId) return
    
    await this.init()
    
    let hasChanges = false
    
    for (const message of messages) {
      // Only sync one-time messages that the current user received
      if (message.view_once && 
          message.receiver_id === currentUserId && 
          message.viewed_at && 
          !this.viewedMessages.has(message.id)) {
        
        this.viewedMessages.add(message.id)
        hasChanges = true
        console.log('🔄 [ONE_TIME_VIEW] Synced viewed state from database:', message.id)
      }
    }
    
    if (hasChanges) {
      await this.persistViewedMessages()
    }
    
    console.log('📊 [ONE_TIME_VIEW] After sync - viewed:', this.viewedMessages.size, 'currently viewing:', this.currentlyViewing.size)
  }

  /**
   * Load and sync with messages from cache/database
   * This should be called when messages are loaded to ensure consistency
   */
  async loadAndSyncMessages(messages, currentUserId) {
    await this.syncWithDatabase(messages, currentUserId)
  }

  /**
   * Get all viewed message IDs for external use
   */
  getViewedMessageIds() {
    return Array.from(this.viewedMessages)
  }

  /**
   * Mark a message as viewed externally (for syncing from other sources)
   */
  async markAsViewed(messageId) {
    if (!messageId || this.viewedMessages.has(messageId)) return false
    
    await this.init()
    this.viewedMessages.add(messageId)
    await this.persistViewedMessages()
    console.log('🔄 [ONE_TIME_VIEW] Externally marked as viewed:', messageId)
    return true
  }

  /**
   * Persist viewed messages to AsyncStorage
   */
  async persistViewedMessages() {
    try {
      const viewedArray = Array.from(this.viewedMessages)
      await AsyncStorage.setItem(ONE_TIME_VIEWED_KEY, JSON.stringify(viewedArray))
    } catch (error) {
      console.error('❌ [ONE_TIME_VIEW] Failed to persist viewed messages:', error)
    }
  }

  /**
   * Clear all viewed messages (for testing or reset)
   */
  async clearAll() {
    this.viewedMessages.clear()
    this.currentlyViewing.clear()
    try {
      await AsyncStorage.removeItem(ONE_TIME_VIEWED_KEY)
      console.log('🧹 [ONE_TIME_VIEW] Cleared all viewed messages')
    } catch (error) {
      console.error('❌ [ONE_TIME_VIEW] Failed to clear storage:', error)
    }
  }

  /**
   * Check if a message is safe to show without blur on initial load
   * Returns true if it's a fresh, unviewed message that can be shown normally
   */
  canShowOnFirstLoad(messageId, currentUserId = null, message = null) {
    if (!this.initialized || !messageId) return false
    
    // If we have message object, validate viewing permissions
    if (message && currentUserId) {
      // Senders can always see their own messages
      if (message.sender_id === currentUserId) {
        return true
      }
      
      // Only one-time messages received by current user are subject to blur
      if (!message.view_once || message.receiver_id !== currentUserId) {
        return true
      }
    }
    
    // If not viewed and not currently viewing, it's safe to show
    const isViewed = this.viewedMessages.has(messageId)
    const isCurrentlyViewing = this.currentlyViewing.has(messageId)
    
    return !isViewed || isCurrentlyViewing
  }

  /**
   * Clear currently viewing state for a specific message
   * Useful when switching between messages quickly or when screen loses focus
   */
  clearCurrentlyViewing(messageId) {
    if (messageId && this.currentlyViewing.has(messageId)) {
      this.currentlyViewing.delete(messageId)
      console.log('🔄 [ONE_TIME_VIEW] Cleared currently viewing state for:', messageId)
      return true
    }
    return false
  }

  /**
   * Clear all currently viewing states 
   * Useful when screen loses focus or app goes to background
   */
  clearAllCurrentlyViewing() {
    const count = this.currentlyViewing.size
    this.currentlyViewing.clear()
    if (count > 0) {
      console.log(`🔄 [ONE_TIME_VIEW] Cleared all currently viewing states (${count} messages)`)
    }
    return count
  }

  /**
   * Get stats for debugging
   */
  getStats() {
    return {
      totalViewed: this.viewedMessages.size,
      currentlyViewing: this.currentlyViewing.size,
      initialized: this.initialized
    }
  }
}

// Export singleton instance
export const oneTimeViewService = new OneTimeViewService()
export default oneTimeViewService
