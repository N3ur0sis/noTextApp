import { clearUserData, clearDeviceId, getOrCreateDeviceId } from '../utils/secureStore'
import { DeviceAuthService } from '../services/deviceAuthService'

/**
 * Debug utilities for resolving authentication issues
 */
export const DebugAuth = {
  
  /**
   * Clear all stored data and force new device ID generation
   */
  async clearAllData() {
    try {
      console.log('🧹 Clearing all stored authentication data...')
      await clearUserData()
      console.log('✅ All data cleared successfully')
      return true
    } catch (error) {
      console.error('❌ Error clearing data:', error)
      return false
    }
  },

  /**
   * Clear only the device ID to force regeneration
   */
  async clearDeviceIdOnly() {
    try {
      console.log('🧹 Clearing device ID only...')
      await clearDeviceId()
      console.log('✅ Device ID cleared successfully')
      return true
    } catch (error) {
      console.error('❌ Error clearing device ID:', error)
      return false
    }
  },

  /**
   * Show current device ID and user data
   */
  async showCurrentState() {
    try {
      const deviceId = await getOrCreateDeviceId()
      const user = await DeviceAuthService.getCurrentUser()
      
      console.log('📱 Current Device ID:', deviceId)
      console.log('👤 Current User:', user ? user.pseudo : 'None')
      console.log('🔐 Is Authenticated:', await DeviceAuthService.isAuthenticated())
      
      return { deviceId, user, isAuthenticated: await DeviceAuthService.isAuthenticated() }
    } catch (error) {
      console.error('❌ Error getting current state:', error)
      return null
    }
  },

  /**
   * Generate a preview of what email would be generated
   */
  async previewEmailGeneration() {
    try {
      const deviceId = await getOrCreateDeviceId()
      const sanitizedId = deviceId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().substring(0, 20)
      const additionalRandomness = Math.random().toString(36).substring(2, 8)
      const previewEmail = `user_${sanitizedId}_${additionalRandomness}@example.com`
      
      console.log('📧 Email that would be generated:', previewEmail)
      console.log('🔧 Based on device ID:', deviceId)
      console.log('🔧 Sanitized portion:', sanitizedId)
      
      return { previewEmail, deviceId, sanitizedId }
    } catch (error) {
      console.error('❌ Error previewing email:', error)
      return null
    }
  }
}
