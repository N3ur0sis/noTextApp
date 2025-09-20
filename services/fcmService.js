/**
 * Firebase Cloud Messaging (FCM) Service
 * Handles native FCM implementation alongside Expo notifications
 */

import { Platform } from 'react-native'

// Gracefully handle Firebase import - it's not available in Expo Go
let messaging = null
let isFirebaseAvailable = false

try {
  // Try to import Firebase messaging
  const firebaseMessaging = require('@react-native-firebase/messaging')
  messaging = firebaseMessaging.default
  isFirebaseAvailable = true
  console.log('🔥 [FCM] Firebase messaging is available')
} catch (error) {
  console.log('🔥 [FCM] Firebase messaging not available (likely running in Expo Go):', error.message)
  isFirebaseAvailable = false
}

// Lazy load pushNotificationService to avoid circular dependency
let pushNotificationService = null
const getPushNotificationService = async () => {
  if (!pushNotificationService) {
    try {
      const pushModule = await import('./pushNotificationService')
      pushNotificationService = pushModule.pushNotificationService
    } catch (error) {
      console.log('🔥 [FCM] Push notification service not available')
    }
  }
  return pushNotificationService
}

class FCMService {
  constructor() {
    this.isInitialized = false
    this.fcmToken = null
    this.messageHandlers = new Map()
  }

  // Initialize FCM service
  async initialize() {
    if (this.isInitialized) {
      console.log('🔥 [FCM] Service already initialized')
      return this.fcmToken
    }

    if (!isFirebaseAvailable) {
      console.log('🔥 [FCM] Firebase not available, skipping FCM initialization')
      return null
    }

    try {
      console.log('🚀 [FCM] Initializing Firebase Cloud Messaging...')

      // Request permission for iOS
      if (Platform.OS === 'ios') {
        const authStatus = await messaging().requestPermission()
        const enabled =
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL

        if (!enabled) {
          console.log('🔥 [FCM] Permission not granted for iOS')
          return null
        }
      }

      // Get FCM token
      this.fcmToken = await messaging().getToken()
      console.log('🔥 [FCM] Token obtained:', this.fcmToken ? 'Success' : 'Failed')

      // Set up message handlers
      this.setupMessageHandlers()

      // Set up token refresh listener
      this.setupTokenRefreshListener()

      this.isInitialized = true
      console.log('✅ [FCM] Firebase Cloud Messaging initialized successfully')

      return this.fcmToken

    } catch (error) {
      console.error('❌ [FCM] Failed to initialize FCM:', error)
      return null
    }
  }

  // Set up message handlers
  setupMessageHandlers() {
    if (!isFirebaseAvailable || !messaging) {
      console.log('🔥 [FCM] Firebase not available, skipping message handlers setup')
      return
    }

    // Handle background messages
    messaging().setBackgroundMessageHandler(async (remoteMessage) => {
      console.log('🔥 [FCM] Background message received:', remoteMessage)
      this.handleBackgroundMessage(remoteMessage)
    })

    // Handle foreground messages
    const unsubscribe = messaging().onMessage(async (remoteMessage) => {
      console.log('🔥 [FCM] Foreground message received:', remoteMessage)
      this.handleForegroundMessage(remoteMessage)
    })

    // Handle notification opened when app is in background
    messaging().onNotificationOpenedApp((remoteMessage) => {
      console.log('🔥 [FCM] Notification opened app (background):', remoteMessage)
      this.handleNotificationOpen(remoteMessage)
    })

    // Handle notification opened when app was closed
    messaging()
      .getInitialNotification()
      .then((remoteMessage) => {
        if (remoteMessage) {
          console.log('🔥 [FCM] Notification opened app (cold start):', remoteMessage)
          this.handleNotificationOpen(remoteMessage)
        }
      })
  }

  // Set up token refresh listener
  setupTokenRefreshListener() {
    if (!isFirebaseAvailable || !messaging) {
      console.log('🔥 [FCM] Firebase not available, skipping token refresh listener setup')
      return
    }

    messaging().onTokenRefresh(async (token) => {
      console.log('🔥 [FCM] Token refreshed:', token)
      this.fcmToken = token
      // Notify push notification service about token update
      const pushService = await getPushNotificationService()
      if (pushService && typeof pushService.handleFCMTokenRefresh === 'function') {
        pushService.handleFCMTokenRefresh(token)
      }
    })
  }

  // Handle background messages
  handleBackgroundMessage(remoteMessage) {
    try {
      const { data, notification } = remoteMessage
      
      // Process the message data
      console.log('🔥 [FCM] Processing background message:', {
        messageId: remoteMessage.messageId,
        data: data,
        notification: notification
      })

      // Emit event for other services to handle
      this.emitMessage('background', remoteMessage)

    } catch (error) {
      console.error('❌ [FCM] Error handling background message:', error)
    }
  }

  // Handle foreground messages
  handleForegroundMessage(remoteMessage) {
    try {
      const { data, notification } = remoteMessage

      // Process the message data
      console.log('🔥 [FCM] Processing foreground message:', {
        messageId: remoteMessage.messageId,
        data: data,
        notification: notification
      })

      // For validation messages, don't show additional notifications
      if (data?.validation === true || data?.validation === 'true') {
        console.log('🔇 [FCM] Skipping notification display for validation message')
        return
      }

      // Show local notification if needed and if pushNotificationService is available
      if (notification) {
        getPushNotificationService().then(pushService => {
          if (pushService) {
            // Use expo-notifications to show the notification
            pushService.presentLocalNotification({
              title: notification.title || 'NoText',
              body: notification.body || 'Nouveau message',
              data: data || {}
            }).catch(error => {
              console.error('❌ [FCM] Error presenting local notification:', error)
            })
          }
        }).catch(error => {
          console.error('❌ [FCM] Error getting push service:', error)
        })
      }

      // Emit event for other services to handle
      this.emitMessage('foreground', remoteMessage)

    } catch (error) {
      console.error('❌ [FCM] Error handling foreground message:', error)
    }
  }  // Handle notification open
  handleNotificationOpen(remoteMessage) {
    try {
      const { data } = remoteMessage

      console.log('🔥 [FCM] Processing notification open:', {
        messageId: remoteMessage.messageId,
        data: data
      })

      // Navigate to appropriate screen based on data
      if (data?.type === 'message' && data?.senderId) {
        console.log('🔥 [FCM] Triggering navigation for message notification')
        
        // Use the same robust navigation system as Expo notifications
        this.triggerRobustNavigation(data)
      }

      // Emit event for other services to handle
      this.emitMessage('opened', remoteMessage)

    } catch (error) {
      console.error('❌ [FCM] Error handling notification open:', error)
    }
  }

  // Trigger robust navigation using the same system as Expo notifications
  async triggerRobustNavigation(data) {
    try {
      const { senderId, senderPseudo, messageId, isNsfw, isOneTime, mediaType } = data
      
      console.log('🔥 [FCM] Triggering robust navigation to chat:', {
        senderId,
        senderPseudo,
        messageId,
        isNsfw,
        isOneTime,
        mediaType
      })

      // Get notification integration service for robust navigation
      const { notificationIntegrationService } = await import('./notificationIntegration')
      
      // Use the same handleDirectNavigateToChat method for consistency
      await notificationIntegrationService.handleDirectNavigateToChat({
        senderId,
        senderPseudo,
        timestamp: Date.now(),
        source: 'fcm',
        messageId,
        isNsfw: isNsfw === 'true' || isNsfw === true,
        isOneTime: isOneTime === 'true' || isOneTime === true,
        mediaType
      })

      console.log('✅ [FCM] Robust navigation triggered successfully')

    } catch (error) {
      console.error('❌ [FCM] Error in robust navigation:', error)
      
      // Fallback to legacy method
      try {
        const pushService = await getPushNotificationService()
        if (pushService && typeof pushService.navigateToChat === 'function') {
          pushService.navigateToChat({
            userId: data.senderId,
            userPseudo: data.senderPseudo
          })
          console.log('🔄 [FCM] Fallback navigation triggered')
        }
      } catch (fallbackError) {
        console.error('❌ [FCM] Fallback navigation also failed:', fallbackError)
      }
    }
  }

  // Emit message events
  emitMessage(type, remoteMessage) {
    const handlers = this.messageHandlers.get(type) || []
    handlers.forEach(handler => {
      try {
        handler(remoteMessage)
      } catch (error) {
        console.error(`❌ [FCM] Error in ${type} message handler:`, error)
      }
    })
  }

  // Subscribe to message events
  onMessage(type, handler) {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, [])
    }
    this.messageHandlers.get(type).push(handler)

    // Return unsubscribe function
    return () => {
      const handlers = this.messageHandlers.get(type)
      if (handlers) {
        const index = handlers.indexOf(handler)
        if (index > -1) {
          handlers.splice(index, 1)
        }
      }
    }
  }

  // Get current FCM token
  getToken() {
    return this.fcmToken
  }

  // Check if FCM is available
  isAvailable() {
    if (!isFirebaseAvailable || !messaging) {
      return false
    }
    return messaging().isDeviceRegisteredForRemoteMessages
  }

  // Run FCM diagnostic
  async runDiagnostic() {
    const diagnostic = {
      fcmAvailable: false,
      tokenGenerated: false,
      permissionGranted: false,
      issues: []
    }

    try {
      // Check if Firebase is available first
      if (!isFirebaseAvailable || !messaging) {
        diagnostic.issues.push('Firebase messaging not available (likely running in Expo Go)')
        console.log('🔥 [FCM] Diagnostic completed:', diagnostic)
        return diagnostic
      }

      // Check if FCM is available
      diagnostic.fcmAvailable = await this.isAvailable()
      if (!diagnostic.fcmAvailable) {
        diagnostic.issues.push('FCM not available on this device')
      }

      // Check token generation
      const token = await messaging().getToken()
      diagnostic.tokenGenerated = !!token
      if (!diagnostic.tokenGenerated) {
        diagnostic.issues.push('Failed to generate FCM token')
      }

      // Check permissions
      if (Platform.OS === 'ios') {
        const authStatus = await messaging().hasPermission()
        diagnostic.permissionGranted = 
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL
        
        if (!diagnostic.permissionGranted) {
          diagnostic.issues.push('FCM permission not granted on iOS')
        }
      } else {
        diagnostic.permissionGranted = true // Android doesn't require explicit FCM permission
      }

      console.log('🔥 [FCM] Diagnostic completed:', diagnostic)
      return diagnostic

    } catch (error) {
      console.error('❌ [FCM] Diagnostic failed:', error)
      diagnostic.issues.push(`Diagnostic error: ${error.message}`)
      return diagnostic
    }
  }
}

// Export singleton instance
export const fcmService = new FCMService()
