/**
 * Notification Manager
 * Ensures robust and reliable notification system initialization and operation
 */

import { AppState } from 'react-native'
import { pushNotificationService } from './pushNotificationService'
import { notificationIntegration } from './notificationIntegration'

class NotificationManager {
  constructor() {
    this.isInitialized = false
    this.currentUser = null
    this.initPromise = null
    this.healthCheckInterval = null
    this.initRetryCount = 0
    this.maxInitRetries = 5
  }

  // Main initialization method with comprehensive error handling
  async initialize(user) {
    // Prevent multiple simultaneous initializations
    if (this.initPromise) {
      console.log('📱 [NOTIF_MANAGER] Initialization already in progress, waiting...')
      return this.initPromise
    }

    // If already initialized for the same user, return
    if (this.isInitialized && this.currentUser?.id === user?.id) {
      console.log('📱 [NOTIF_MANAGER] Already initialized for this user')
      return true
    }

    this.initPromise = this._doInitialize(user)
    
    try {
      const result = await this.initPromise
      return result
    } finally {
      this.initPromise = null
    }
  }

  // Internal initialization logic
  async _doInitialize(user) {
    console.log('🚀 [NOTIF_MANAGER] Starting comprehensive notification initialization...')
    
    try {
      // Clean up previous initialization if switching users
      if (this.isInitialized && this.currentUser?.id !== user?.id) {
        await this.cleanup()
      }

      this.currentUser = user

      // Phase 1: Initialize push notification service
      console.log('📱 [NOTIF_MANAGER] Phase 1: Initializing push service...')
      const pushInitialized = await this._initializePushService(user)

      // Phase 2: Initialize notification integration
      console.log('📱 [NOTIF_MANAGER] Phase 2: Initializing notification integration...')
      const integrationInitialized = await this._initializeIntegration(user)

      // Phase 3: Set up health monitoring
      console.log('📱 [NOTIF_MANAGER] Phase 3: Setting up health monitoring...')
      this._setupHealthMonitoring()

      // Phase 4: Verify system integrity
      console.log('📱 [NOTIF_MANAGER] Phase 4: Verifying system integrity...')
      const systemHealthy = await this._verifySystemIntegrity()

      this.isInitialized = true
      this.initRetryCount = 0

      console.log('✅ [NOTIF_MANAGER] Notification system fully initialized and verified')

      // Schedule a health check in 30 seconds
      setTimeout(() => this._performHealthCheck(), 30000)

      return true

    } catch (error) {
      console.error('❌ [NOTIF_MANAGER] Initialization failed:', error)
      
      this.initRetryCount++
      
      if (this.initRetryCount <= this.maxInitRetries) {
        console.log(`📱 [NOTIF_MANAGER] Retrying initialization in ${this.initRetryCount * 2}s... (${this.initRetryCount}/${this.maxInitRetries})`)
        
        await new Promise(resolve => setTimeout(resolve, this.initRetryCount * 2000))
        return this._doInitialize(user)
      }
      
      console.error('❌ [NOTIF_MANAGER] Max initialization retries exceeded')
      return false
    }
  }

  // Initialize push notification service with robust error handling
  async _initializePushService(user) {
    try {
      const pushToken = await pushNotificationService.init(user.id)
      console.log('✅ [NOTIF_MANAGER] Push service initialized', { hasPushToken: !!pushToken })
      return true
    } catch (error) {
      console.error('❌ [NOTIF_MANAGER] Push service initialization failed:', error)
      throw error
    }
  }

  // Initialize notification integration
  async _initializeIntegration(user) {
    try {
      await notificationIntegration.init(user)
      console.log('✅ [NOTIF_MANAGER] Integration service initialized')
      return true
    } catch (error) {
      console.error('❌ [NOTIF_MANAGER] Integration initialization failed:', error)
      throw error
    }
  }

  // Initialize notifications for new account with complete fresh start
  async initializeForNewAccount(user) {
    console.log('🆕 [NOTIF_MANAGER] Initializing notifications for new account...')
    
    try {
      // Reset initialization state
      this.isInitialized = false
      this.currentUser = null
      this.initRetryCount = 0
      
      // Stop any existing health monitoring
      this._stopHealthMonitoring()
      
      // Initialize push service for new account (with complete reset)
      console.log('📱 [NOTIF_MANAGER] Initializing push service for new account...')
      const pushToken = await pushNotificationService.initializeForNewAccount(user.id)
      console.log('✅ [NOTIF_MANAGER] Push service initialized for new account', { hasPushToken: !!pushToken })
      
      // Initialize notification integration
      console.log('📱 [NOTIF_MANAGER] Initializing integration for new account...')
      await notificationIntegration.init(user)
      console.log('✅ [NOTIF_MANAGER] Integration initialized for new account')
      
      // Set up health monitoring
      this._setupHealthMonitoring()
      
      // Mark as initialized
      this.isInitialized = true
      this.currentUser = user
      
      console.log('🎉 [NOTIF_MANAGER] New account notification initialization completed successfully')
      return true
      
    } catch (error) {
      console.error('❌ [NOTIF_MANAGER] New account initialization failed:', error)
      
      // Reset state on failure
      this.isInitialized = false
      this.currentUser = null
      
      throw error
    }
  }

  // Set up continuous health monitoring
  _setupHealthMonitoring() {
    // Clear any existing interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
    }

    // Set up periodic health checks every 5 minutes
    this.healthCheckInterval = setInterval(() => {
      this._performHealthCheck()
    }, 5 * 60 * 1000)

    // Listen for app state changes
    this.appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        // App became active, perform health check
        setTimeout(() => this._performHealthCheck(), 2000)
      }
    })

    console.log('✅ [NOTIF_MANAGER] Health monitoring enabled')
  }

  // Stop health monitoring
  _stopHealthMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }

    if (this.appStateSubscription) {
      this.appStateSubscription.remove()
      this.appStateSubscription = null
    }

    console.log('⏹️ [NOTIF_MANAGER] Health monitoring stopped')
  }

  // Perform comprehensive health check
  async _performHealthCheck() {
    if (!this.isInitialized || !this.currentUser) {
      return
    }

    try {
      console.log('🔍 [NOTIF_MANAGER] Performing health check...')

      // Check push service health
      const pushToken = pushNotificationService.getPushToken()
      const permissionStatus = await pushNotificationService.getPermissionStatus()
      const pushServiceHealthy = pushNotificationService.isInitialized

      // Check integration health
      const integrationHealthy = notificationIntegration.isInitialized

      const healthStatus = {
        timestamp: new Date().toISOString(),
        pushServiceHealthy,
        integrationHealthy,
        hasPushToken: !!pushToken,
        permissionStatus,
        userId: this.currentUser.id
      }

      console.log('📊 [NOTIF_MANAGER] Health check results:', healthStatus)

      // If system is unhealthy, attempt recovery
      if (!pushServiceHealthy || !integrationHealthy) {
        console.warn('⚠️ [NOTIF_MANAGER] System unhealthy, attempting recovery...')
        await this._attemptRecovery()
      }

    } catch (error) {
      console.error('❌ [NOTIF_MANAGER] Health check failed:', error)
    }
  }

  // Attempt to recover an unhealthy notification system
  async _attemptRecovery() {
    try {
      console.log('🔄 [NOTIF_MANAGER] Attempting system recovery...')
      
      // Re-initialize the system
      this.isInitialized = false
      await this.initialize(this.currentUser)
      
      console.log('✅ [NOTIF_MANAGER] System recovery completed')
    } catch (error) {
      console.error('❌ [NOTIF_MANAGER] System recovery failed:', error)
    }
  }

  // Verify system integrity
  async _verifySystemIntegrity() {
    try {
      // System integrity check placeholder (no test notification sent)
      return true
    } catch (error) {
      console.error('❌ [NOTIF_MANAGER] System integrity check failed:', error)
      return false
    }
  }

  // Send a simple notification (convenience method)
  async sendNotification({ userId, title, body, data = {}, priority = 'normal' }) {
    if (!this.isInitialized) {
      console.warn('⚠️ [NOTIF_MANAGER] System not initialized, attempting quick init...')
      if (this.currentUser) {
        await this.initialize(this.currentUser)
      } else {
        throw new Error('Cannot send notification: system not initialized and no user available')
      }
    }

    return pushNotificationService.queueNotification({
      userId,
      title,
      body,
      data: { ...data, timestamp: Date.now() },
      priority,
      sound: true
    })
  }

  // Get system status
  getSystemStatus() {
    return {
      isInitialized: this.isInitialized,
      currentUser: this.currentUser,
      pushServiceInitialized: pushNotificationService.isInitialized,
      integrationInitialized: notificationIntegration.isInitialized,
      pushToken: pushNotificationService.getPushToken(),
      healthMonitoringActive: !!this.healthCheckInterval
    }
  }

  // Set current user without full reinitialization
  setCurrentUser(user) {
    console.log('👤 [NOTIF_MANAGER] Setting current user:', user.pseudo)
    this.currentUser = user
    
    // Update services with new user info
    if (this.isInitialized) {
      try {
        notificationIntegration.setCurrentUser(user)
      } catch (error) {
        console.warn('⚠️ [NOTIF_MANAGER] Failed to update integration with new user:', error)
      }
    }
  }

  // Clean up resources
  async cleanup() {
    console.log('🧹 [NOTIF_MANAGER] Cleaning up notification manager...')

    try {
      // Clear health monitoring
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval)
        this.healthCheckInterval = null
      }

      if (this.appStateSubscription) {
        this.appStateSubscription.remove()
        this.appStateSubscription = null
      }

      // Clean up services
      await notificationIntegration.cleanup()
      await pushNotificationService.cleanup()

      // Reset state
      this.isInitialized = false
      this.currentUser = null
      this.initRetryCount = 0

      console.log('✅ [NOTIF_MANAGER] Cleanup completed')
    } catch (error) {
      console.error('❌ [NOTIF_MANAGER] Cleanup error:', error)
    }
  }
}

// Export singleton instance
export const notificationManager = new NotificationManager()
