/**
 * Chat Visibility Service
 * Tracks which conversation is currently active and if user is on home screen
 * to prevent notifications when user is already viewing relevant content
 */

class ChatVisibilityService {
  constructor() {
    this.currentChatUserId = null
    this.isChatScreenVisible = false
    this.isHomeScreenVisible = false
    this.listeners = new Set()
  }

  // Set the current chat user when ChatScreen is mounted
  setChatVisible(otherUserId) {
    const wasVisible = this.isChatScreenVisible
    const wasUserId = this.currentChatUserId
    
    this.currentChatUserId = otherUserId
    this.isChatScreenVisible = true
    this.isHomeScreenVisible = false // Clear home screen when in chat
    
    if (!wasVisible || wasUserId !== otherUserId) {
      console.log(`👁️ [CHAT_VISIBILITY] Chat screen visible for user: ${otherUserId}`)
      this.notifyListeners({
        type: 'chatVisible',
        userId: otherUserId,
        isVisible: true
      })
    }
  }

  // Clear chat visibility when ChatScreen is unmounted
  setChatHidden() {
    const wasVisible = this.isChatScreenVisible
    const wasUserId = this.currentChatUserId
    
    this.currentChatUserId = null
    this.isChatScreenVisible = false
    
    if (wasVisible) {
      console.log(`👁️ [CHAT_VISIBILITY] Chat screen hidden for user: ${wasUserId}`)
      this.notifyListeners({
        type: 'chatHidden',
        userId: wasUserId,
        isVisible: false
      })
    }
  }

  // Set home screen visibility when HomeScreen is focused
  setHomeScreenVisible() {
    console.log(`👁️ [VISIBILITY_SERVICE] setHomeScreenVisible called - current state: ${this.isHomeScreenVisible}`)
    const wasVisible = this.isHomeScreenVisible
    
    this.isHomeScreenVisible = true
    this.isChatScreenVisible = false // Clear chat screen when on home
    this.currentChatUserId = null
    
    if (!wasVisible) {
      console.log(`👁️ [CHAT_VISIBILITY] Home screen visible`)
      this.notifyListeners({
        type: 'homeVisible',
        isVisible: true
      })
    } else {
      console.log(`👁️ [VISIBILITY_SERVICE] Home screen was already visible`)
    }
  }

  // Clear home screen visibility when HomeScreen is unfocused
  setHomeScreenHidden() {
    console.log(`👁️ [VISIBILITY_SERVICE] setHomeScreenHidden called - current state: ${this.isHomeScreenVisible}`)
    const wasVisible = this.isHomeScreenVisible
    
    this.isHomeScreenVisible = false
    
    if (wasVisible) {
      console.log(`👁️ [CHAT_VISIBILITY] Home screen hidden`)
      this.notifyListeners({
        type: 'homeHidden',
        isVisible: false
      })
    } else {
      console.log(`👁️ [VISIBILITY_SERVICE] Home screen was already hidden`)
    }
  }

  // Check if user is currently viewing chat with specific sender
  isViewingChatWith(senderId) {
    return this.isChatScreenVisible && 
           this.currentChatUserId === senderId
  }

  // Check if user is currently on home screen (conversation list)
  isViewingHomeScreen() {
    return this.isHomeScreenVisible
  }

  // Check if user is viewing any app content where notifications should be suppressed
  shouldSuppressNotifications(senderId = null) {
    console.log(`👁️ [VISIBILITY_SERVICE] shouldSuppressNotifications called for sender: ${senderId}`)
    console.log(`👁️ [VISIBILITY_SERVICE] Current state - Home: ${this.isHomeScreenVisible}, Chat: ${this.isChatScreenVisible}, ChatUser: ${this.currentChatUserId}`)
    
    // If on home screen, suppress all notifications since user sees real-time updates
    if (this.isHomeScreenVisible) {
      console.log(`👁️ [VISIBILITY_SERVICE] Suppressing notification - user on home screen`)
      return true
    }
    
    // If in specific chat with the sender, suppress notifications
    if (this.isChatScreenVisible && senderId && this.currentChatUserId === senderId) {
      console.log(`👁️ [VISIBILITY_SERVICE] Suppressing notification - user in chat with sender ${senderId}`)
      return true
    }
    
    console.log(`👁️ [VISIBILITY_SERVICE] NOT suppressing notification`)
    return false
  }

  // Get current visibility state
  getCurrentState() {
    return {
      isHomeVisible: this.isHomeScreenVisible,
      isChatVisible: this.isChatScreenVisible,
      currentChatUserId: this.currentChatUserId
    }
  }

  // Add listener for visibility changes
  addListener(callback) {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  // Notify all listeners of visibility changes
  notifyListeners(data) {
    this.listeners.forEach(listener => {
      try {
        listener(data)
      } catch (error) {
        console.error('❌ [CHAT_VISIBILITY] Error in listener:', error)
      }
    })
  }

  // Debug method to get current state
  getDebugInfo() {
    return {
      currentChatUserId: this.currentChatUserId,
      isChatScreenVisible: this.isChatScreenVisible,
      isHomeScreenVisible: this.isHomeScreenVisible,
      listenerCount: this.listeners.size
    }
  }
}

// Export singleton instance
export const chatVisibilityService = new ChatVisibilityService()
