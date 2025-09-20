import AsyncStorage from '@react-native-async-storage/async-storage'
import { apiManager } from './apiManager'

class UnreadCountService {
  constructor() {
    this.userViewedMessages = new Set()
    this.initialized = false
  }

  async init() {
    if (this.initialized) return
    
    try {
      // Load user-actually-viewed messages from storage
      const userViewed = await AsyncStorage.getItem('userViewedMessages')
      if (userViewed) {
        this.userViewedMessages = new Set(JSON.parse(userViewed))
      }
      this.initialized = true
      console.log('🔢 [UNREAD] Service initialized with', this.userViewedMessages.size, 'viewed messages')
    } catch (error) {
      console.error('❌ [UNREAD] Error initializing service:', error)
    }
  }

  async markMessageAsUserViewed(messageId) {
    if (!this.initialized) await this.init()
    
    this.userViewedMessages.add(messageId)
    try {
      await AsyncStorage.setItem('userViewedMessages', JSON.stringify([...this.userViewedMessages]))
      console.log('🔢 [UNREAD] Marked message as user viewed:', messageId)
    } catch (error) {
      console.error('❌ [UNREAD] Error saving viewed message:', error)
    }
  }

  // Called when a message is actually marked as read in the database
  async markMessageAsRead(messageId) {
    if (!this.initialized) await this.init()
    
    // Mark as user viewed since if it's read in DB, user must have seen it
    await this.markMessageAsUserViewed(messageId)
  }

  // Clean up viewed messages that are already marked as seen in database
  async cleanupViewedMessages(currentUserId, otherUserId) {
    if (!this.initialized) await this.init()
    
    try {
      const cacheKey = `messages_currentUserId:${currentUserId}|otherUserId:${otherUserId}`
      const messages = apiManager.getFromCache(cacheKey) || []
      
      let cleaned = false
      for (const message of messages) {
        // If message is marked as seen in DB, ensure it's also marked as user viewed
        if (message.sender_id === otherUserId && 
            message.seen === true && 
            !this.userViewedMessages.has(message.id)) {
          this.userViewedMessages.add(message.id)
          cleaned = true
          console.log(`🧹 [UNREAD] Cleaned up viewed message that was already seen in DB: ${message.id}`)
        }
      }
      
      if (cleaned) {
        await AsyncStorage.setItem('userViewedMessages', JSON.stringify([...this.userViewedMessages]))
      }
    } catch (error) {
      console.error('❌ [UNREAD] Error cleaning up viewed messages:', error)
    }
  }

  async getUnreadCountForConversation(currentUserId, otherUserId) {
    if (!this.initialized) await this.init()
    
    try {
      // First cleanup any messages that are already seen in DB but not marked as user viewed
      await this.cleanupViewedMessages(currentUserId, otherUserId)
      
      // Get messages from cache
      const cacheKey = `messages_currentUserId:${currentUserId}|otherUserId:${otherUserId}`
      const messages = apiManager.getFromCache(cacheKey) || []
      
      let unreadCount = 0
      for (const message of messages) {
        // Count messages from other user that:
        // 1. Haven't been marked as seen in the database (seen !== true)
        // 2. AND haven't been actually viewed by user interaction
        if (message.sender_id === otherUserId && 
            message.seen !== true && 
            !this.userViewedMessages.has(message.id)) {
          unreadCount++
        }
      }
      
      console.log(`🔢 [UNREAD] Conversation ${otherUserId}: ${unreadCount} unread messages (${messages.length} total, ${messages.filter(m => m.sender_id === otherUserId).length} from other user, ${messages.filter(m => m.sender_id === otherUserId && m.seen === true).length} marked seen in DB)`)
      return unreadCount
    } catch (error) {
      console.error('❌ [UNREAD] Error calculating unread count:', error)
      return 0
    }
  }

  isMessageUserViewed(messageId) {
    return this.userViewedMessages.has(messageId)
  }

  // Get total unread count across all conversations
  async getTotalUnreadCount(currentUserId, conversations = []) {
    if (!this.initialized) await this.init()
    
    let totalUnread = 0
    for (const conversation of conversations) {
      const otherUserId = conversation.receiver_id === currentUserId 
        ? conversation.sender_id 
        : conversation.receiver_id || conversation.otherUser?.id
      
      if (otherUserId) {
        const count = await this.getUnreadCountForConversation(currentUserId, otherUserId)
        totalUnread += count
      }
    }
    
    return totalUnread
  }
}

export const unreadCountService = new UnreadCountService()
