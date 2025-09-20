/**
 * One-Time View Debug Utility
 * Helper functions for testing and debugging one-time view functionality
 */

import { oneTimeViewService } from './oneTimeViewService'

class OneTimeViewDebugger {
  /**
   * Log current state of one-time view service
   */
  static logState() {
    const stats = oneTimeViewService.getStats()
    console.log('🐛 [ONE_TIME_DEBUG] Current state:', {
      ...stats,
      viewedMessageIds: oneTimeViewService.getViewedMessageIds()
    })
  }

  /**
   * Test blur state for specific messages
   */
  static testBlurState(messageIds) {
    if (!Array.isArray(messageIds)) {
      messageIds = [messageIds]
    }

    console.log('🐛 [ONE_TIME_DEBUG] Testing blur states:')
    messageIds.forEach(messageId => {
      console.log(`  Message ${messageId}:`, {
        shouldShowBlur: oneTimeViewService.shouldShowBlur(messageId),
        isViewed: oneTimeViewService.isViewed(messageId),
        isCurrentlyViewing: oneTimeViewService.isCurrentlyViewing(messageId)
      })
    })
  }

  /**
   * Clear all viewed messages (for testing)
   */
  static async clearAll() {
    await oneTimeViewService.clearAll()
    console.log('🐛 [ONE_TIME_DEBUG] Cleared all viewed messages')
  }

  /**
   * Simulate viewing a message
   */
  static async simulateView(messageId, duration = 3000) {
    console.log('🐛 [ONE_TIME_DEBUG] Simulating view for message:', messageId)
    
    await oneTimeViewService.startViewing(messageId)
    console.log('  - Started viewing')
    
    setTimeout(async () => {
      await oneTimeViewService.stopViewing(messageId)
      console.log('  - Stopped viewing (should now be blurred)')
      this.testBlurState(messageId)
    }, duration)
  }

  /**
   * Log all viewed messages from storage
   */
  static async logStoredViews() {
    try {
      const AsyncStorage = await import('@react-native-async-storage/async-storage')
      const stored = await AsyncStorage.default.getItem('oneTimeViewedMessages')
      console.log('🐛 [ONE_TIME_DEBUG] Stored viewed messages:', stored ? JSON.parse(stored) : [])
    } catch (error) {
      console.error('🐛 [ONE_TIME_DEBUG] Error reading storage:', error)
    }
  }
}

// Export debugger functions for global access
export const oneTimeDebug = OneTimeViewDebugger

// In development, attach to global for easy access
if (__DEV__) {
  global.oneTimeDebug = OneTimeViewDebugger
}

export default OneTimeViewDebugger
