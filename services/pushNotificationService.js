/**
 * Push Notification Service
 * Handles push notification registration, sending, and management for iOS and Android
 */

import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { Platform, AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabaseClient'
import { blockService } from './blockService'

// Import FCM service only if available (lazy load to avoid circular dependency)
let fcmService = null
const getFCMService = async () => {
  if (!fcmService) {
    try {
      const fcmModule = await import('./fcmService')
      fcmService = fcmModule.fcmService
    } catch (error) {
      console.log('📱 [PUSH] FCM service not available, using Expo notifications only')
    }
  }
  return fcmService
}

const PUSH_TOKEN_KEY = '@NoText:pushToken'
const NOTIFICATION_SETTINGS_KEY = '@NoText:notificationSettings'

// Configure how notifications are handled when app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    // Check if we're in the chat screen with the sender
    const data = notification.request.content.data
    
    // Block notifications from blocked users
    if (data?.senderId && await blockService.shouldBlockNotification(data.senderId)) {
      console.log('📵 [PUSH] Blocking notification from blocked user:', data.senderId)
      return {
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }
    }
    
    const isInChatWithSender = await checkIfInChatWithSender(data?.senderId)
    
    return {
      shouldShowBanner: !isInChatWithSender, // Don't show banner if already in chat with sender
      shouldShowList: !isInChatWithSender, // Don't show in notification list if already in chat with sender
      shouldPlaySound: true,
      shouldSetBadge: true,
    }
  },
})

class PushNotificationService {
  constructor() {
    this.pushToken = null
    this.isInitialized = false
    this.listeners = new Map()
    this.notificationQueue = []
    this.isProcessingQueue = false
    this.currentChatUserId = null // Track current chat screen
    this.lastNavigationTime = 0 // Track last navigation to prevent duplicates
    
    // Monitoring properties
    this.monitoringInterval = null
    this.tokenCheckInterval = null
    this.appStateSubscription = null
    this.lastAppState = AppState.currentState
  }

  // Event system
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event).push(callback)
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event)
      const index = callbacks.indexOf(callback)
      if (index > -1) {
        callbacks.splice(index, 1)
      }
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => {
        try {
          callback(data)
        } catch (error) {
          console.error('❌ [PUSH] Event callback error:', error)
        }
      })
    }
  }

  // Initialize the push notification service with robust retry mechanism
  async init(userId, retryCount = 0) {
    const maxRetries = 3

    if (this.isInitialized) {
      console.log('📱 [PUSH] Service already initialized')
      return this.pushToken
    }

    console.log('🚀 [PUSH] ===== STARTING PUSH NOTIFICATION INITIALIZATION =====')
    console.log('� [PUSH] User ID:', userId)
    console.log('📱 [PUSH] Retry count:', retryCount)
    console.log('📱 [PUSH] Platform:', Platform.OS)
    console.log('📱 [PUSH] Is device:', Device.isDevice)

    try {

      // IMPORTANT: Clear any existing token cache for fresh start on new account
      if (retryCount === 0) {
        await this.clearTokenCacheForFreshStart()
      }

      // Check if device supports push notifications
      if (!Device.isDevice) {
        console.log('📱 [PUSH] ❌ Must use physical device for push notifications')
        // Still initialize service for development/testing
        this.isInitialized = true
        return null
      }

      console.log('📱 [PUSH] ✅ Physical device detected')

      // Perform device compatibility check
      const compatibility = await this.checkDeviceCompatibility()
      if (compatibility?.issues?.length > 0) {
        console.log('⚠️ [PUSH] Device compatibility issues detected:', compatibility.issues)
        // Continue initialization but warn about potential issues
      }

      console.log('📱 [PUSH] Device compatibility check passed')

      // Request permissions with retry
      console.log('📱 [PUSH] ===== REQUESTING PERMISSIONS =====')
      const permission = await this.requestPermissions()
      console.log('📱 [PUSH] Permission result:', permission)
      if (!permission) {
        if (retryCount < maxRetries) {
          console.log(`📱 [PUSH] Permission denied, retrying in 2s... (${retryCount + 1}/${maxRetries})`)
          await new Promise(resolve => setTimeout(resolve, 2000))
          return this.init(userId, retryCount + 1)
        }
        console.log('📱 [PUSH] Push notification permission denied after retries')
        
        // For Android, provide specific guidance
        if (Platform.OS === 'android' && compatibility) {
          console.log('💡 [PUSH] Android permission troubleshooting:')
          compatibility.issues.forEach(issue => console.log(`- ${issue}`))
        }
        
        // Still initialize service without permissions
        this.isInitialized = true
        return null
      }

      // Get or register push token with retry
      console.log('📱 [PUSH] ===== GETTING PUSH TOKEN =====')
      this.pushToken = await this.getOrRegisterPushToken()
      console.log('📱 [PUSH] Push token result:', this.pushToken ? 'SUCCESS' : 'FAILED')
      console.log('📱 [PUSH] Push token value:', this.pushToken)
      
      // Initialize FCM service for enhanced Android support
      try {
        const fcmSvc = await getFCMService()
        if (fcmSvc) {
          this.fcmToken = await fcmSvc.initialize()
          if (this.fcmToken) {
            console.log('📱 [PUSH] FCM token obtained:', this.fcmToken.substring(0, 20) + '...')
            // Store FCM token alongside Expo token for redundancy
          }
        }
      } catch (fcmError) {
        console.warn('⚠️ [PUSH] FCM initialization failed, continuing with Expo only:', fcmError.message)
      }
      
      if (this.pushToken && userId) {
        // Update user's push token in database with retry
        const updateSuccess = await this.updateUserPushToken(userId, this.pushToken)
        if (!updateSuccess && retryCount < maxRetries) {
          console.log(`📱 [PUSH] Failed to update push token, retrying... (${retryCount + 1}/${maxRetries})`)
          await new Promise(resolve => setTimeout(resolve, 1000))
          return this.init(userId, retryCount + 1)
        }
      }

      // Set up notification listeners
      this.setupNotificationListeners()

      // Load notification settings
      await this.loadNotificationSettings()

      // Start automated monitoring for production-ready reliability
      this.startAutomatedMonitoring()

      this.isInitialized = true
      console.log('✅ [PUSH] Push notification service initialized successfully')

      return this.pushToken

    } catch (error) {
      console.error(`❌ [PUSH] Failed to initialize push notifications (attempt ${retryCount + 1}):`, error)
      
      if (retryCount < maxRetries) {
        console.log(`📱 [PUSH] Retrying initialization in 3s... (${retryCount + 1}/${maxRetries})`)
        await new Promise(resolve => setTimeout(resolve, 3000))
        return this.init(userId, retryCount + 1)
      }
      
      // Final fallback - initialize service in limited mode
      console.log('📱 [PUSH] Initializing service in limited mode (no push notifications)')
      this.isInitialized = true
      return null
    }
  }

  // Request push notification permissions with enhanced Android handling and production-grade channels
  async requestPermissions() {
    try {
      console.log('🔐 [PUSH] ===== REQUESTING NOTIFICATION PERMISSIONS =====')
      
      const { status: existingStatus } = await Notifications.getPermissionsAsync()
      console.log('🔐 [PUSH] Existing permission status:', existingStatus)
      let finalStatus = existingStatus

      if (existingStatus !== 'granted') {
        console.log('📱 [PUSH] Requesting notification permission...')
        const { status } = await Notifications.requestPermissionsAsync()
        finalStatus = status
        console.log('🔐 [PUSH] Permission request result:', finalStatus)
      }

      if (finalStatus !== 'granted') {
        console.log('❌ [PUSH] Push notification permission not granted')
        
        // Device-specific permission guidance
        if (Platform.OS === 'android') {
          await this.handleAndroidPermissionFailure()
        }
        return false
      }

      console.log('✅ [PUSH] Notification permissions granted')

      // Configure production-grade notification channels for Android
      if (Platform.OS === 'android') {
        await this.setupProductionNotificationChannels()
      }

      return true
    } catch (error) {
      console.error('❌ [PUSH] Error requesting permissions:', error)
      
      // Enhanced error handling for Android permission issues
      if (Platform.OS === 'android') {
        await this.handleAndroidPermissionFailure()
      }
      
      return false
    }
  }

  // Setup production-grade notification channels with high priority and device-specific optimizations
  async setupProductionNotificationChannels() {
    try {
      console.log('📢 [PUSH] Setting up production notification channels...')

      // Critical/Urgent Messages - HIGHEST PRIORITY
      await Notifications.setNotificationChannelAsync('critical_messages', {
        name: 'Critical Messages',
        importance: Notifications.AndroidImportance.MAX, // Highest priority
        vibrationPattern: [0, 300, 200, 300, 200, 300], // Strong vibration pattern
        lightColor: '#FF4444',
        sound: 'default',
        enableVibrate: true,
        enableLights: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true, // Always bypass Do Not Disturb
        showBadge: true,
        description: 'Important messages that require immediate attention'
      })

      // Regular Messages - HIGH PRIORITY (Expo docs recommend "high" for best delivery)
      await Notifications.setNotificationChannelAsync('messages', {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH, // High priority as per Expo docs
        vibrationPattern: [0, 250, 150, 250],
        lightColor: '#8b5cf6',
        sound: 'default',
        enableVibrate: true,
        enableLights: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: false,
        showBadge: true,
        description: 'New messages from other users'
      })

      // System notifications - DEFAULT PRIORITY
      await Notifications.setNotificationChannelAsync('system', {
        name: 'System',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 100],
        lightColor: '#00AA00',
        sound: false,
        enableVibrate: false,
        enableLights: false,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
        bypassDnd: false,
        showBadge: false,
        description: 'App updates and system messages'
      })

      // Background/Silent notifications - LOW PRIORITY
      await Notifications.setNotificationChannelAsync('background', {
        name: 'Background Updates',
        importance: Notifications.AndroidImportance.LOW,
        sound: false,
        enableVibrate: false,
        enableLights: false,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.SECRET,
        bypassDnd: false,
        showBadge: false,
        description: 'Silent background updates'
      })

      console.log('✅ [PUSH] Production notification channels configured')

      // Verify channels were created successfully
      const channels = await Notifications.getNotificationChannelsAsync()
      console.log(`📢 [PUSH] Created ${channels.length} notification channels:`, 
        channels.map(ch => `${ch.name} (${ch.importance})`))

    } catch (error) {
      console.error('❌ [PUSH] Error setting up notification channels:', error)
      throw error
    }
  }

  // Handle Android permission failures with device-specific guidance
  async handleAndroidPermissionFailure() {
    const deviceInfo = await this.getDetailedDeviceInfo()
    
    console.log('⚠️ [PUSH] Android permission failure - providing device-specific guidance')
    console.log('📱 [PUSH] Device:', `${deviceInfo.brand} ${deviceInfo.modelName} (${deviceInfo.manufacturer})`)
    
    const recommendations = [
      'Enable notifications in Settings → Apps → NoText → Notifications',
      'Disable battery optimization in Settings → Battery → Battery Optimization → NoText → Don\'t optimize',
      'Enable auto-start in Settings → Apps → NoText → Auto-start (if available)'
    ]

    // Samsung-specific guidance
    if (deviceInfo.isSamsung) {
      recommendations.push(
        'Samsung: Enable "Allow background activity" in Settings → Apps → NoText → Battery',
        'Samsung: Add to "Never sleeping apps" in Settings → Device care → Battery → More → Never sleeping apps',
        'Samsung: Disable "Put unused apps to sleep" in Settings → Device care → Battery → More'
      )
    }

    // Xiaomi/MIUI-specific guidance
    if (deviceInfo.isXiaomi) {
      recommendations.push(
        'MIUI: Enable "Auto-start" in Security → Permissions → Auto-start',
        'MIUI: Set battery saver to "No restrictions" for this app',
        'MIUI: Add to "Protected apps" list'
      )
    }

    // OnePlus-specific guidance
    if (deviceInfo.isOnePlus) {
      recommendations.push(
        'OnePlus: Disable "Adaptive Battery" optimization for this app',
        'OnePlus: Enable "Allow background activity" in App settings'
      )
    }

    console.log('💡 [PUSH] Recommendations:')
    recommendations.forEach((rec, index) => console.log(`${index + 1}. ${rec}`))
  }

  // Clear token cache for fresh start (important for new accounts)
  async clearTokenCacheForFreshStart() {
    try {
      console.log('🧹 [PUSH] Clearing token cache for fresh account start...')
      
      // Clear stored push token
      await AsyncStorage.removeItem(PUSH_TOKEN_KEY)
      
      // Clear any health metrics from previous account
      await AsyncStorage.removeItem('notificationHealthMetrics')
      
      // Clear device compatibility cache  
      await AsyncStorage.removeItem('deviceCompatibilityCache')
      
      // Clear notification settings cache
      await AsyncStorage.removeItem(NOTIFICATION_SETTINGS_KEY)
      
      // Reset internal state
      this.pushToken = null
      
      console.log('✅ [PUSH] Token cache cleared for fresh start')
      
    } catch (error) {
      console.error('❌ [PUSH] Error clearing token cache:', error)
    }
  }

  // Complete fresh initialization for new account creation
  async initializeForNewAccount(userId) {
    try {
      console.log('🆕 [PUSH] Initializing push notifications for new account...')
      
      // Stop any existing monitoring
      this.stopAutomatedMonitoring()
      
      // Clear all existing data
      await this.performCompleteSystemReset()
      
      // Small delay to ensure cleanup is complete
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Initialize fresh
      const token = await this.init(userId)
      
      // Perform immediate health check
      setTimeout(async () => {
        const healthReport = await this.performNotificationHealthCheck()
        console.log('📊 [PUSH] Initial health check for new account:', healthReport.overall)
      }, 3000)
      
      return token
      
    } catch (error) {
      console.error('❌ [PUSH] Error initializing for new account:', error)
      throw error
    }
  }

  // Garantie un départ 100% propre pour nouvelle installation APK
  async ensureCleanInstallation() {
    try {
      console.log('🧼 [PUSH] Ensuring completely clean installation...')
      
      // Arrêter tout monitoring existant
      this.stopAutomatedMonitoring()
      
      // Vider COMPLETEMENT tout le cache AsyncStorage lié aux notifications
      const keysToRemove = [
        PUSH_TOKEN_KEY,
        NOTIFICATION_SETTINGS_KEY,
        'notificationHealthMetrics',
        'deviceCompatibilityCache',
        'expoPushToken',
        'fcmToken',
        'lastTokenRefresh',
        'notificationPermissionStatus',
        'channelSetupStatus',
        'deviceNotificationSetup'
      ]
      
      await AsyncStorage.multiRemove(keysToRemove)
      console.log('✅ [PUSH] Removed all notification-related cache keys')
      
      // Nettoyer toutes les notifications existantes
      if (Platform.OS === 'android') {
        try {
          // Supprimer tous les canaux de notification existants et les recréer
          const channels = await Notifications.getNotificationChannelsAsync()
          for (const channel of channels) {
            await Notifications.deleteNotificationChannelAsync(channel.id)
          }
          console.log('✅ [PUSH] Cleared all existing notification channels')
        } catch (error) {
          console.log('⚠️ [PUSH] Could not clear notification channels:', error.message)
        }
      }
      
      // Supprimer toutes les notifications en attente et délivrées
      await Notifications.dismissAllNotificationsAsync()
      await Notifications.cancelAllScheduledNotificationsAsync()
      console.log('✅ [PUSH] Cleared all pending and delivered notifications')
      
      // Reset complet de l'état interne
      this.pushToken = null
      this.fcmToken = null
      this.isInitialized = false
      this.currentChatUserId = null
      this.notificationQueue = []
      this.isProcessingQueue = false
      this.settings = null
      this.listeners.clear()
      
      console.log('✅ [PUSH] Complete clean installation guaranteed')
      return true
      
    } catch (error) {
      console.error('❌ [PUSH] Error ensuring clean installation:', error)
      return false
    }
  }

    // Get existing push token or register new one with enhanced Android support and health checks
  async getOrRegisterPushToken() {
    try {
      console.log('🔑 [PUSH] ===== STARTING TOKEN GENERATION PROCESS =====')

      // Try to get existing token from storage
      const storedToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY)
      console.log('🔑 [PUSH] Stored token check:', storedToken ? 'FOUND' : 'NOT FOUND')
      
      if (storedToken) {
        console.log('📱 [PUSH] Found stored token, validating...')
        const isValid = await this.validatePushTokenWithExpoPing(storedToken)
        console.log('🔑 [PUSH] Stored token validation:', isValid ? 'VALID' : 'INVALID')
        if (isValid) {
          console.log('✅ [PUSH] Stored token is valid')
          return storedToken
        } else {
          console.log('❌ [PUSH] Stored token is invalid, will generate new one')
          await AsyncStorage.removeItem(PUSH_TOKEN_KEY)
        }
      }

      console.log('🔑 [PUSH] ===== GENERATING NEW TOKEN =====')
      // Generate new token with enhanced error handling and retries
      const newToken = await this.generateNewPushTokenWithRetry()
      console.log('🔑 [PUSH] New token generation result:', newToken ? 'SUCCESS' : 'FAILED')
      
      if (newToken) {
        // Validate the new token before storing
        const isNewTokenValid = await this.validatePushTokenWithExpoPing(newToken)
        if (isNewTokenValid) {
          await AsyncStorage.setItem(PUSH_TOKEN_KEY, newToken)
          console.log('✅ [PUSH] New push token validated and stored')
          return newToken
        } else {
          console.error('❌ [PUSH] Generated token failed validation!')
          throw new Error('Generated push token failed validation')
        }
      }
      
      throw new Error('Failed to generate valid push token')

    } catch (error) {
      console.error('❌ [PUSH] Error in token generation process:', error)
      
      // Device-specific guidance
      if (Platform.OS === 'android') {
        const deviceInfo = await this.getDetailedDeviceInfo()
        console.log('💡 [PUSH] Android troubleshooting for token generation:')
        
        if (deviceInfo.isSamsung) {
          console.log('- Samsung: Check "Smart switch" and "Samsung Cloud" aren\'t interfering')
          console.log('- Samsung: Ensure "Game Optimizing Service" isn\'t affecting the app')
        }
        
        console.log('- Ensure Google Play Services is updated')
        console.log('- Check if device has Google Play Services (some Chinese ROMs don\'t)')
        console.log('- Verify device time and timezone are correct')
        console.log('- Try connecting to different network (Wi-Fi vs mobile data)')
      }
      
      return null
    }
  }

  // Generate new push token with retry mechanism and robust error handling
  async generateNewPushTokenWithRetry(maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 [PUSH] Token generation attempt ${attempt}/${maxRetries}`)
        
        // Get device info for debugging
        const deviceInfo = await this.getDetailedDeviceInfo()
        console.log('📱 [PUSH] Device details:', {
          brand: deviceInfo.brand,
          model: deviceInfo.modelName,
          android: deviceInfo.osVersion,
          manufacturer: deviceInfo.manufacturer
        })

        // Robustly resolve projectId from all possible sources
        const projectId = this.getProjectId()
        
        if (!projectId) {
          throw new Error('No Expo projectId detected in configuration! Push notifications will not work.')
        }

        console.log('🎯 [PUSH] Using Project ID:', projectId)

        // Device-specific pre-checks
        if (Platform.OS === 'android') {
          await this.performAndroidPreChecks(deviceInfo)
        }

        // Generate token with timeout protection
        console.log('🔄 [PUSH] Calling Notifications.getExpoPushTokenAsync...')
        const tokenPromise = Notifications.getExpoPushTokenAsync({ projectId })
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Token generation timeout')), 30000) // 30 second timeout
        })

        const result = await Promise.race([tokenPromise, timeoutPromise])
        const newToken = result.data
        console.log('🔄 [PUSH] Token generation raw result:', result)
        console.log('🔄 [PUSH] Extracted token:', newToken)

        if (!newToken) {
          throw new Error('Token generation returned null/undefined')
        }

        // Validate token format
        if (!newToken.startsWith('ExponentPushToken[')) {
          throw new Error(`Invalid token format: ${newToken.substring(0, 30)}...`)
        }

        console.log('✅ [PUSH] Token generated successfully:', newToken.substring(0, 30) + '...')
        return newToken

      } catch (error) {
        console.error(`❌ [PUSH] Token generation attempt ${attempt} failed:`, error.message)
        
        if (attempt === maxRetries) {
          throw error
        }

        // Progressive retry delays: 2s, 5s, 10s
        const delay = attempt * 2000 + (attempt - 1) * 3000
        console.log(`⏳ [PUSH] Retrying in ${delay/1000}s...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  // Get project ID from all possible configuration sources
  getProjectId() {
    const sources = {
      'Constants.expoConfig.extra.eas.projectId': Constants?.expoConfig?.extra?.eas?.projectId,
      'Constants.easConfig.projectId': Constants?.easConfig?.projectId,
      'Constants.manifest.extra.eas.projectId': Constants?.manifest?.extra?.eas?.projectId,
      'Constants.expoProjectId': Constants?.expoProjectId,
      'process.env.EXPO_PUBLIC_PROJECT_ID': process.env.EXPO_PUBLIC_PROJECT_ID,
      'Constants.expoConfig.extra.expoProjectId': Constants?.expoConfig?.extra?.expoProjectId
    }

    // Log all sources for debugging
    console.log('🔍 [PUSH] Project ID sources:', sources)

    const projectId = (
      Constants?.expoConfig?.extra?.eas?.projectId
      ?? Constants?.easConfig?.projectId
      ?? Constants?.manifest?.extra?.eas?.projectId
      ?? Constants?.expoProjectId
      ?? process.env.EXPO_PUBLIC_PROJECT_ID
      ?? Constants?.expoConfig?.extra?.expoProjectId
    )

    console.log('✅ [PUSH] Resolved Project ID:', projectId)
    return projectId
  }

  // Perform Android-specific pre-checks before token generation
  async performAndroidPreChecks(deviceInfo) {
    console.log('🔍 [PUSH] Performing Android pre-checks...')

    // Check for problematic device configurations
    const problematicBrands = ['Huawei', 'Honor', 'Xiaomi', 'OnePlus', 'Oppo', 'Vivo', 'Realme']
    const brandMatch = problematicBrands.find(brand => 
      deviceInfo.brand?.toLowerCase().includes(brand.toLowerCase()) ||
      deviceInfo.manufacturer?.toLowerCase().includes(brand.toLowerCase())
    )

    if (brandMatch) {
      console.log(`⚠️ [PUSH] ${brandMatch} device detected - known to have aggressive power management`)
    }

    // Samsung-specific checks
    if (deviceInfo.isSamsung) {
      console.log('🔍 [PUSH] Samsung device detected - performing Samsung-specific checks')
      
      // Samsung devices often have additional power management
      console.log('💡 [PUSH] Samsung recommendations:')
      console.log('- Ensure "Adaptive battery" is not restricting this app')
      console.log('- Check "Device care" → "Battery" → "App power management"')
      console.log('- Verify app is not in "Deep sleeping apps" list')
    }

    // Check Android version compatibility
    const androidVersion = parseInt(deviceInfo.osVersion?.split('.')[0] || '0')
    if (androidVersion >= 12) {
      console.log('🔍 [PUSH] Android 12+ detected - enhanced privacy controls may affect notifications')
    }
  }

  // Validate push token by pinging Expo's validation endpoint
  async validatePushTokenWithExpoPing(token) {
    try {
      console.log('🧪 [PUSH] Validating token with Expo ping...')

      if (!token || !token.startsWith('ExponentPushToken[')) {
        console.log('❌ [PUSH] Invalid token format')
        return false
      }

      // Choose validation method based on environment
      const isProduction = !__DEV__

      if (isProduction) {
        // PRODUCTION: Use a minimal data-only push to validate without showing notifications
        console.log('🔇 [PUSH] Production mode: Using minimal validation push')

        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Accept-encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: token,
            data: {
              validation: true,
              timestamp: Date.now(),
              type: 'validation'
            },
            priority: 'default',
            ttl: 30, // Expire in 30 seconds
            // Don't include title/body to avoid showing notification
          }),
        })

        if (!response.ok) {
          console.log(`❌ [PUSH] Minimal validation request failed with status: ${response.status}`)
          return false
        }

        const result = await response.json()
        console.log('🔇 [PUSH] Minimal validation result:', result)

        // Handle both array and object response formats from Expo
        let validationData = null

        if (result.data && Array.isArray(result.data) && result.data[0]) {
          validationData = result.data[0]
        } else if (result.data && typeof result.data === 'object' && result.data.status) {
          validationData = result.data
        }

        if (validationData) {
          const { status, details } = validationData
          const isValid = status === 'ok'

          if (!isValid) {
            console.log(`❌ [PUSH] Minimal token validation failed: ${status} - ${details || 'No details'}`)
          } else {
            console.log('✅ [PUSH] Minimal token validation successful')
          }

          return isValid
        }

        console.log('❌ [PUSH] Unexpected minimal validation response format')
        return false

      } else {
        // DEVELOPMENT: Send visible validation notification for debugging
        console.log('🔧 [PUSH] Development mode: Sending visible validation notification')

        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Accept-encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: token,
            title: '🔧 Token Validation (Dev)',
            body: 'Validating push token functionality - DEV MODE',
            data: {
              validation: true,
              timestamp: Date.now(),
              _displayInForeground: true // Show in development for debugging
            },
            priority: 'high',
            sound: 'default',
            channelId: 'messages' // Use messages channel for better visibility
          }),
        })

        if (!response.ok) {
          console.log(`❌ [PUSH] Dev validation request failed with status: ${response.status}`)
          return false
        }

        const result = await response.json()
        console.log('🧪 [PUSH] Dev validation result:', result)

        // Handle both array and object response formats from Expo
        let validationData = null

        if (result.data && Array.isArray(result.data) && result.data[0]) {
          validationData = result.data[0]
        } else if (result.data && typeof result.data === 'object' && result.data.status) {
          validationData = result.data
        }

        if (validationData) {
          const { status, details, id } = validationData
          const isValid = status === 'ok'

          if (!isValid) {
            console.log(`❌ [PUSH] Dev token validation failed: ${status} - ${details || 'No details'}`)

            // Handle specific error cases
            if (status === 'DeviceNotRegistered') {
              console.log('📱 [PUSH] Device not registered - token is invalid')
            } else if (status === 'InvalidCredentials') {
              console.log('🔑 [PUSH] Invalid credentials - check project configuration')
            }
          } else {
            console.log('✅ [PUSH] Dev token validation successful')
            if (id) {
              console.log('🆔 [PUSH] Validation ID:', id)
            }
          }

          return isValid
        }

        console.log('❌ [PUSH] Unexpected dev validation response format:', result)
        return false
      }
    } catch (error) {
      console.error('❌ [PUSH] Token validation error:', error)
      return false
    }
  }  // Get detailed device information for troubleshooting
  async getDetailedDeviceInfo() {
    try {
      const deviceInfo = {
        isPhysicalDevice: Device.isDevice,
        platform: Platform.OS,
        osVersion: Device.osVersion,
        brand: Device.brand,
        manufacturer: Device.manufacturer,
        modelName: Device.modelName,
        platformApiLevel: Device.platformApiLevel,
        
        // Derived flags for easier checking
        isSamsung: false,
        isXiaomi: false,
        isOnePlus: false,
        isHuawei: false
      }

      // Set device-specific flags
      const brand = deviceInfo.brand?.toLowerCase() || ''
      const manufacturer = deviceInfo.manufacturer?.toLowerCase() || ''
      
      deviceInfo.isSamsung = brand.includes('samsung') || manufacturer.includes('samsung')
      deviceInfo.isXiaomi = brand.includes('xiaomi') || manufacturer.includes('xiaomi') || brand.includes('redmi')
      deviceInfo.isOnePlus = brand.includes('oneplus') || manufacturer.includes('oneplus')
      deviceInfo.isHuawei = brand.includes('huawei') || manufacturer.includes('huawei') || brand.includes('honor')

      return deviceInfo
    } catch (error) {
      console.error('❌ [PUSH] Error getting device info:', error)
      return { platform: Platform.OS, error: error.message }
    }
  }

  // Enhanced verification with device compatibility check
  async verifyPushToken(token) {
    try {
      // Basic token format validation
      if (!token || !token.startsWith('ExponentPushToken[')) {
        console.log('📱 [PUSH] Invalid token format')
        return false
      }

      // Additional verification for production
      if (!__DEV__) {
        // In production, you could verify with Expo's API
        // For now, assume valid if format is correct
      }

      return true
    } catch (error) {
      console.error('❌ [PUSH] Token verification error:', error)
      return false
    }
  }

  // Check device compatibility for push notifications
  async checkDeviceCompatibility() {
    try {
      const compatibility = {
        isPhysicalDevice: Device.isDevice,
        platform: Platform.OS,
        osVersion: Device.osVersion,
        brand: Device.brand,
        manufacturer: Device.manufacturer,
        modelName: Device.modelName,
        hasGooglePlayServices: true, // Assume true, would need specific check
        issues: []
      }

      // Check for known problematic configurations
      if (Platform.OS === 'android') {
        const problematicBrands = ['Huawei', 'Honor', 'Xiaomi', 'OnePlus', 'Oppo', 'Vivo', 'Realme']
        const brandMatch = problematicBrands.find(brand => 
          compatibility.brand?.toLowerCase().includes(brand.toLowerCase()) ||
          compatibility.manufacturer?.toLowerCase().includes(brand.toLowerCase())
        )

        if (brandMatch) {
          compatibility.issues.push(`${brandMatch} devices may require manual battery optimization and auto-start configuration`)
        }

        // Check Android version
        const androidVersion = parseInt(compatibility.osVersion?.split('.')[0] || '0')
        if (androidVersion >= 6) {
          compatibility.issues.push('Android 6+ requires careful permission and battery management')
        }
      }

      console.log('📱 [PUSH] Device compatibility check:', compatibility)
      return compatibility
    } catch (error) {
      console.error('❌ [PUSH] Device compatibility check failed:', error)
      return null
    }
  }

  // Update user's push token in database
  async updateUserPushToken(userId, pushToken) {
    try {
      const { error } = await supabase
        .from('users')
        .update({
          push_token: pushToken,
          push_token_updated_at: new Date().toISOString(),
          notifications_enabled: true
        })
        .eq('id', userId)

      if (error) {
        console.error('❌ [PUSH] Error updating push token in database:', error)
        return false
      }

      console.log('✅ [PUSH] Push token updated in database')
      return true

    } catch (error) {
      console.error('❌ [PUSH] Error updating push token:', error)
      return false
    }
  }

  // Set up notification event listeners with enhanced app state handling
  setupNotificationListeners() {
    try {
      // Set up app state monitoring for background/foreground transitions
      this.setupAppStateMonitoring()

      // Handle notification received while app is foregrounded
      this.notificationListener = Notifications.addNotificationReceivedListener(async notification => {
        console.log('📱 [PUSH] Notification received:', notification)
        await this.handleNotificationReceived(notification)
      })

      // Handle notification tapped/clicked
      this.responseListener = Notifications.addNotificationResponseReceivedListener(async response => {
        console.log('📱 [PUSH] Notification tapped:', response)
        await this.handleNotificationTapped(response)
      })

      // Handle background notification responses (iOS specific)
      if (Platform.OS === 'ios') {
        this.backgroundListener = Notifications.addNotificationResponseReceivedListener(response => {
          if (response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
            console.log('📱 [PUSH] iOS background notification handled')
          }
        })
      }

      console.log('✅ [PUSH] Enhanced notification listeners set up')

    } catch (error) {
      console.error('❌ [PUSH] Error setting up notification listeners:', error)
    }
  }

  // Set up app state monitoring for notification reliability
  setupAppStateMonitoring() {
    const { AppState } = require('react-native')
    
    this.appState = AppState.currentState
    this.appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      console.log(`📱 [PUSH] App state changed: ${this.appState} -> ${nextAppState}`)
      
      if (this.appState.match(/inactive|background/) && nextAppState === 'active') {
        console.log('📱 [PUSH] App came to foreground - checking notification health')
        // Perform health check when app becomes active
        this.performNotificationHealthCheck()
      } else if (this.appState === 'active' && nextAppState.match(/inactive|background/)) {
        console.log('📱 [PUSH] App going to background - ensuring notification reliability')
        // Ensure notifications will work in background
        this.ensureBackgroundNotificationReliability()
      }
      
      this.appState = nextAppState
    })
  }

  // Perform comprehensive notification health check with automatic remediation
  async performNotificationHealthCheck() {
    try {
      console.log('🔍 [PUSH] Performing comprehensive notification health check...')
      
      const healthReport = {
        timestamp: new Date().toISOString(),
        permissions: { status: 'unknown', issues: [] },
        token: { status: 'unknown', issues: [] },
        channels: { status: 'unknown', issues: [] },
        device: { status: 'unknown', issues: [] },
        overall: 'unknown',
        remediation: []
      }

      // 1. Check permission status
      const permissionResult = await this.checkPermissionHealth()
      healthReport.permissions = permissionResult
      
      if (!permissionResult.healthy) {
        console.log('❌ [PUSH] Permission issues detected:', permissionResult.issues)
        healthReport.remediation.push('Request notification permissions again')
      }

      // 2. Check token health
      const tokenResult = await this.checkTokenHealth()
      healthReport.token = tokenResult
      
      if (!tokenResult.healthy) {
        console.log('❌ [PUSH] Token issues detected:', tokenResult.issues)
        
        // Automatic token remediation
        if (tokenResult.shouldRefresh) {
          console.log('🔄 [PUSH] Attempting automatic token refresh...')
          const refreshSuccess = await this.refreshPushTokenWithValidation()
          
          if (refreshSuccess) {
            console.log('✅ [PUSH] Token refreshed successfully')
            healthReport.token.status = 'refreshed'
            healthReport.remediation.push('Token automatically refreshed')
          } else {
            console.log('❌ [PUSH] Token refresh failed')
            healthReport.remediation.push('Manual token refresh required')
          }
        }
      }

      // 3. Check notification channels (Android only)
      if (Platform.OS === 'android') {
        const channelResult = await this.checkChannelHealth()
        healthReport.channels = channelResult
        
        if (!channelResult.healthy) {
          console.log('❌ [PUSH] Channel issues detected:', channelResult.issues)
          
          // Attempt to recreate channels
          try {
            await this.setupProductionNotificationChannels()
            console.log('✅ [PUSH] Notification channels recreated')
            healthReport.remediation.push('Notification channels recreated')
          } catch (error) {
            console.log('❌ [PUSH] Failed to recreate channels:', error)
            healthReport.remediation.push('Manual channel configuration required')
          }
        }
      }

      // 4. Check device-specific health
      const deviceResult = await this.checkDeviceHealth()
      healthReport.device = deviceResult
      
      if (!deviceResult.healthy) {
        console.log('⚠️ [PUSH] Device-specific issues detected:', deviceResult.issues)
        healthReport.remediation.push(...deviceResult.recommendations)
      }

      // 5. Determine overall health
      const allHealthy = [
        healthReport.permissions.healthy,
        healthReport.token.healthy,
        Platform.OS === 'ios' || healthReport.channels.healthy, // Skip channels for iOS
        deviceResult.severity !== 'critical'
      ].every(Boolean)

      healthReport.overall = allHealthy ? 'healthy' : 'requires_attention'

      console.log('📊 [PUSH] Health check completed:', {
        overall: healthReport.overall,
        permissions: healthReport.permissions.healthy ? '✅' : '❌',
        token: healthReport.token.healthy ? '✅' : '❌',
        channels: Platform.OS === 'android' ? (healthReport.channels.healthy ? '✅' : '❌') : 'N/A',
        device: deviceResult.severity === 'none' ? '✅' : `⚠️ ${deviceResult.severity}`
      })

      // Emit health check results for UI to handle
      this.emit('healthCheckCompleted', healthReport)

      return healthReport

    } catch (error) {
      console.error('❌ [PUSH] Health check failed:', error)
      return {
        overall: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      }
    }
  }

  // Check permission health status
  async checkPermissionHealth() {
    try {
      const { status, canAskAgain, granted } = await Notifications.getPermissionsAsync()
      
      const result = {
        status,
        healthy: status === 'granted',
        canAskAgain,
        granted,
        issues: []
      }

      if (status !== 'granted') {
        result.issues.push(`Permission status: ${status}`)
        
        if (!canAskAgain) {
          result.issues.push('Cannot ask for permission again - user must enable manually')
        }
      }

      return result
    } catch (error) {
      return {
        healthy: false,
        issues: [`Permission check failed: ${error.message}`]
      }
    }
  }

  // Check token health with validation
  async checkTokenHealth() {
    try {
      const result = {
        healthy: false,
        issues: [],
        shouldRefresh: false,
        token: this.pushToken
      }

      if (!this.pushToken) {
        result.issues.push('No push token available')
        result.shouldRefresh = true
        return result
      }

      // Validate token format
      if (!this.pushToken.startsWith('ExponentPushToken[')) {
        result.issues.push('Invalid token format')
        result.shouldRefresh = true
        return result
      }

      // Validate token with Expo service
      const isValid = await this.validatePushTokenWithExpoPing(this.pushToken)
      
      if (!isValid) {
        result.issues.push('Token failed validation with Expo service')
        result.shouldRefresh = true
        return result
      }

      result.healthy = true
      return result

    } catch (error) {
      return {
        healthy: false,
        issues: [`Token health check failed: ${error.message}`],
        shouldRefresh: true
      }
    }
  }

  // Check notification channel health (Android only)
  async checkChannelHealth() {
    try {
      const channels = await Notifications.getNotificationChannelsAsync()
      
      const result = {
        healthy: true,
        issues: [],
        channels: channels.length,
        details: []
      }

      const requiredChannels = ['critical_messages', 'messages', 'system', 'background']
      const existingChannelIds = channels.map(ch => ch.id)

      // Check if all required channels exist
      const missingChannels = requiredChannels.filter(id => !existingChannelIds.includes(id))
      
      if (missingChannels.length > 0) {
        result.healthy = false
        result.issues.push(`Missing channels: ${missingChannels.join(', ')}`)
      }

      // Check channel importance levels
      channels.forEach(channel => {
        const detail = {
          id: channel.id,
          name: channel.name,
          importance: channel.importance,
          enabled: channel.importance > 0
        }
        
        result.details.push(detail)
        
        if (!detail.enabled) {
          result.healthy = false
          result.issues.push(`Channel '${channel.name}' is disabled`)
        }
      })

      return result

    } catch (error) {
      return {
        healthy: false,
        issues: [`Channel health check failed: ${error.message}`]
      }
    }
  }

  // Check device-specific health issues
  async checkDeviceHealth() {
    try {
      const deviceInfo = await this.getDetailedDeviceInfo()
      
      const result = {
        healthy: true,
        severity: 'none', // none, warning, critical
        issues: [],
        recommendations: [],
        deviceInfo
      }

      // Samsung-specific checks
      if (deviceInfo.isSamsung) {
        result.issues.push('Samsung device detected - may have aggressive power management')
        result.recommendations.push(
          'Ensure app is added to "Never sleeping apps" in Samsung Device Care',
          'Disable "Adaptive battery" restrictions for this app',
          'Check "App power management" settings in Device Care'
        )
        result.severity = 'warning'
      }

      // Xiaomi/MIUI checks
      if (deviceInfo.isXiaomi) {
        result.issues.push('Xiaomi/MIUI device detected - requires manual configuration')
        result.recommendations.push(
          'Enable "Auto-start" in MIUI Security app',
          'Set battery saver to "No restrictions"',
          'Add to "Protected apps" list in Security app'
        )
        result.severity = 'warning'
      }

      // OnePlus checks
      if (deviceInfo.isOnePlus) {
        result.issues.push('OnePlus device detected - check battery optimization')
        result.recommendations.push(
          'Disable "Adaptive Battery" optimization',
          'Enable "Allow background activity" in app settings'
        )
        result.severity = 'warning'
      }

      // Huawei checks (critical - often lacks Google Play Services)
      if (deviceInfo.isHuawei) {
        result.issues.push('Huawei device detected - may lack Google Play Services')
        result.recommendations.push(
          'Verify Google Play Services is installed and updated',
          'Consider using Huawei Push Kit if Google services unavailable'
        )
        result.severity = 'critical'
      }

      // Android version checks
      if (Platform.OS === 'android') {
        const androidVersion = parseInt(deviceInfo.osVersion?.split('.')[0] || '0')
        
        if (androidVersion >= 12) {
          result.issues.push('Android 12+ detected - enhanced privacy controls active')
          result.recommendations.push(
            'Check "App hibernation" and "Unused app removal" settings',
            'Verify notification permission is not restricted by privacy controls'
          )
        }
        
        if (androidVersion >= 6 && androidVersion < 10) {
          result.issues.push('Older Android version - manual battery optimization required')
          result.recommendations.push(
            'Manually disable battery optimization for this app',
            'Enable "Allow in background" in app settings'
          )
        }
      }

      result.healthy = result.severity === 'none'
      return result

    } catch (error) {
      return {
        healthy: false,
        severity: 'critical',
        issues: [`Device health check failed: ${error.message}`]
      }
    }
  }

  // Refresh push token with comprehensive validation
  async refreshPushTokenWithValidation() {
    try {
      console.log('🔄 [PUSH] Starting token refresh with validation...')

      // Clear existing token
      this.pushToken = null
      await AsyncStorage.removeItem(PUSH_TOKEN_KEY)
      
      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Generate new token
      const newToken = await this.generateNewPushTokenWithRetry(3)
      
      if (!newToken) {
        throw new Error('Failed to generate new token')
      }

      // Validate new token
      const isValid = await this.validatePushTokenWithExpoPing(newToken)
      
      if (!isValid) {
        throw new Error('New token failed validation')
      }

      // Store and set new token
      this.pushToken = newToken
      await AsyncStorage.setItem(PUSH_TOKEN_KEY, newToken)

      console.log('✅ [PUSH] Token refresh completed successfully')
      
      // Emit token refresh event
      this.emit('tokenRefreshed', { 
        newToken: newToken.substring(0, 30) + '...',
        timestamp: Date.now()
      })

      return true

    } catch (error) {
      console.error('❌ [PUSH] Token refresh failed:', error)
      
      // Emit token refresh failure
      this.emit('tokenRefreshFailed', { 
        error: error.message,
        timestamp: Date.now()
      })

      return false
    }
  }

  // Ensure background notification reliability
  async ensureBackgroundNotificationReliability() {
    try {
      // For Android, check if battery optimization is affecting notifications
      if (Platform.OS === 'android') {
        console.log('📱 [PUSH] Android: Ensuring background reliability')
        
        // Log guidance for users experiencing issues
        console.log('💡 [PUSH] For reliable Android notifications:')
        console.log('- Disable battery optimization for this app')
        console.log('- Enable auto-start/background app refresh')
        console.log('- Check manufacturer-specific power management settings')
      }

      // For iOS, ensure proper background modes are configured
      if (Platform.OS === 'ios') {
        console.log('📱 [PUSH] iOS: Background notification support configured')
      }

    } catch (error) {
      console.error('❌ [PUSH] Background reliability check failed:', error)
    }
  }

  // Handle notification received while app is open
  async handleNotificationReceived(notification) {
    const data = notification.request.content.data
    
    // Block notifications from blocked users
    if (data?.senderId && await blockService.shouldBlockNotification(data.senderId)) {
      console.log('📵 [PUSH] Blocking received notification from blocked user:', data.senderId)
      return
    }
    
    this.emit('notificationReceived', {
      notification,
      data,
      timestamp: Date.now()
    })

    // Update badge count if needed
    this.updateBadgeCount()
  }

  // Handle notification tapped (user opened app from notification)
  // Handle notification tapped with production-ready debouncing and direct navigation
  async handleNotificationTapped(response) {
    const data = response.notification.request.content.data
    
    console.log('📱 [PUSH] Notification tapped with data:', data)

    // Block notifications from blocked users
    if (data?.senderId && await blockService.shouldBlockNotification(data.senderId)) {
      console.log('📵 [PUSH] Blocking tapped notification from blocked user:', data.senderId)
      return
    }

    // Strong debounce protection - prevent multiple rapid taps
    const now = Date.now()
    if (this.lastNavigationTime && now - this.lastNavigationTime < 1500) {
      console.log('📱 [PUSH] Ignoring rapid notification tap (debounce protection)')
      return
    }
    this.lastNavigationTime = now

    // Clear all notifications immediately to prevent confusion
    this.clearAllNotifications()
    
    this.emit('notificationTapped', {
      response,
      data,
      timestamp: now
    })

    // Enhanced navigation handling for message notifications
    if (data?.type === 'message' && data?.senderId) {
      console.log(`📱 [PUSH] Opening app to home screen for message from: ${data.senderPseudo} (${data.senderId})`)
      
      // Always open to home screen instead of direct chat navigation
      this.emit('openApp', {
        senderId: data.senderId,
        senderPseudo: data.senderPseudo || data.chatUserPseudo || 'Utilisateur',
        timestamp: now,
        source: 'notification_tap',
        hasNewMessage: true
      })
    } else {
      console.log('📱 [PUSH] Opening app from notification (no specific chat)')
      this.emit('openApp', {
        timestamp: now,
        source: 'notification_tap'
      })
    }
  }

  // Set current chat user (to avoid notifications for current chat)
  setCurrentChatUser(userId) {
    this.currentChatUserId = userId
    console.log(`📱 [PUSH] Current chat user set to: ${userId || 'none'}`)
  }

  // Queue notification for sending (used by message service)
  async queueNotification({
    userId,
    title,
    body,
    data = {},
    priority = 'normal',
    sound = 'default'
  }) {
    if (!userId) {
      console.error('❌ [PUSH] Cannot queue notification without userId')
      return false
    }

    const notification = {
      userId,
      title,
      body,
      data,
      priority,
      sound,
      timestamp: Date.now(),
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }

    this.notificationQueue.push(notification)
    console.log(`📱 [PUSH] Notification queued: ${notification.id}`)

    // Process queue
    this.processNotificationQueue()

    return notification.id
  }

  // Process notification queue
  async processNotificationQueue() {
    if (this.isProcessingQueue || this.notificationQueue.length === 0) {
      return
    }

    this.isProcessingQueue = true
    console.log(`📱 [PUSH] Processing ${this.notificationQueue.length} notifications`)

    while (this.notificationQueue.length > 0) {
      const notification = this.notificationQueue.shift()
      
      try {
        await this.sendPushNotification(notification)
      } catch (error) {
        console.error('❌ [PUSH] Error sending notification:', error)
      }

      // Small delay between notifications
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    this.isProcessingQueue = false
  }

  // Send push notification via Supabase Edge Function
  async sendPushNotification(notification) {
    try {
      console.log(`📱 [PUSH] Sending notification to user ${notification.userId}`)

      const { data, error } = await supabase.functions.invoke('send-push-notification', {
        body: {
          userId: notification.userId,
          title: notification.title,
          body: notification.body,
          data: notification.data,
          priority: notification.priority,
          sound: notification.sound
        }
      })

      if (error) {
        console.error('❌ [PUSH] Error from push function:', error)
        return false
      }

      console.log('✅ [PUSH] Notification sent successfully:', data)
      return true

    } catch (error) {
      console.error('❌ [PUSH] Error sending push notification:', error)
      return false
    }
  }

  // Update badge count
  async updateBadgeCount(count = null) {
    try {
      if (count === null) {
        // Get unread count from database or cache
        count = await this.getUnreadCount()
      }

      await Notifications.setBadgeCountAsync(count)
      console.log(`📱 [PUSH] Badge count updated to: ${count}`)

    } catch (error) {
      console.error('❌ [PUSH] Error updating badge count:', error)
    }
  }

  // Get unread message count
  async getUnreadCount() {
    try {
      // This would typically come from your message service or cache
      // For now, return 0
      return 0
    } catch (error) {
      console.error('❌ [PUSH] Error getting unread count:', error)
      return 0
    }
  }

  // Load notification settings
  async loadNotificationSettings() {
    try {
      const stored = await AsyncStorage.getItem(NOTIFICATION_SETTINGS_KEY)
      if (stored) {
        this.settings = JSON.parse(stored)
      } else {
        this.settings = {
          messages: true,
          sounds: true,
          vibration: true,
          badges: true
        }
        await this.saveNotificationSettings()
      }
      
      console.log('📱 [PUSH] Notification settings loaded:', this.settings)
    } catch (error) {
      console.error('❌ [PUSH] Error loading notification settings:', error)
      this.settings = { messages: true, sounds: true, vibration: true, badges: true }
    }
  }

  // Save notification settings
  async saveNotificationSettings() {
    try {
      await AsyncStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(this.settings))
    } catch (error) {
      console.error('❌ [PUSH] Error saving notification settings:', error)
    }
  }

  // Update notification settings
  async updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings }
    await this.saveNotificationSettings()
    console.log('📱 [PUSH] Settings updated:', this.settings)
  }

  // Clear all notifications
  async clearAllNotifications() {
    try {
      await Notifications.dismissAllNotificationsAsync()
      await this.updateBadgeCount(0)
      console.log('📱 [PUSH] All notifications cleared')
    } catch (error) {
      console.error('❌ [PUSH] Error clearing notifications:', error)
    }
  }

  // Clear notifications for a specific sender/conversation
  async clearNotificationsForSender(senderId) {
    return clearNotificationsForSender(senderId)
  }

  // Enhanced cleanup when user logs out
  async cleanup() {
    try {
      console.log('🧹 [PUSH] Starting enhanced cleanup...')

      // Remove all notification listeners
      if (this.notificationListener) {
        this.notificationListener.remove()
        this.notificationListener = null
      }
      if (this.responseListener) {
        this.responseListener.remove()
        this.responseListener = null
      }
      if (this.backgroundListener) {
        this.backgroundListener.remove()
        this.backgroundListener = null
      }

      // Remove app state subscription
      if (this.appStateSubscription) {
        this.appStateSubscription.remove()
        this.appStateSubscription = null
      }

      // Stop automated monitoring
      this.stopAutomatedMonitoring()

      // Clear notifications
      await this.clearAllNotifications()

      // Clear stored token (but keep for next user if same device)
      // await AsyncStorage.removeItem(PUSH_TOKEN_KEY)

      // Reset state
      this.pushToken = null
      this.isInitialized = false
      this.currentChatUserId = null
      this.notificationQueue = []
      this.isProcessingQueue = false
      this.appState = null

      // Clear all event listeners
      this.listeners.clear()

      console.log('✅ [PUSH] Enhanced cleanup completed')

    } catch (error) {
      console.error('❌ [PUSH] Error during cleanup:', error)
    }
  }

  // Get current push token
  getPushToken() {
    return this.pushToken
  }

  // Check notification permissions status
  async getPermissionStatus() {
    try {
      const { status } = await Notifications.getPermissionsAsync()
      return status
    } catch (error) {
      console.error('❌ [PUSH] Error getting permission status:', error)
      return 'undetermined'
    }
  }

  // Comprehensive notification diagnostic for troubleshooting
  async runNotificationDiagnostic() {
    console.log('🔍 [PUSH] Running comprehensive notification diagnostic...')
    
    const diagnostic = {
      timestamp: new Date().toISOString(),
      device: {},
      permissions: {},
      configuration: {},
      issues: [],
      recommendations: []
    }

    try {
      // Device information
      diagnostic.device = {
        isPhysicalDevice: Device.isDevice,
        platform: Platform.OS,
        osVersion: Device.osVersion,
        brand: Device.brand,
        manufacturer: Device.manufacturer,
        modelName: Device.modelName
      }

      // Permission status
      const permissionResult = await Notifications.getPermissionsAsync()
      diagnostic.permissions = {
        status: permissionResult.status,
        granted: permissionResult.status === 'granted',
        canAskAgain: permissionResult.canAskAgain,
        details: permissionResult
      }

      // Service configuration
      diagnostic.configuration = {
        isInitialized: this.isInitialized,
        hasPushToken: !!this.pushToken,
        pushTokenFormat: this.pushToken ? (this.pushToken.startsWith('ExponentPushToken[') ? 'valid' : 'invalid') : 'none',
        appState: this.appState,
        hasListeners: !!(this.notificationListener && this.responseListener)
      }

      // Check for issues
      if (!diagnostic.device.isPhysicalDevice) {
        diagnostic.issues.push('Running on simulator/emulator - push notifications not supported')
      }

      if (!diagnostic.permissions.granted) {
        diagnostic.issues.push('Push notification permission not granted')
        diagnostic.recommendations.push('Grant notification permission in device settings')
      }

      if (!diagnostic.configuration.hasPushToken) {
        diagnostic.issues.push('No push token available')
        diagnostic.recommendations.push('Reinitialize notification service')
      }

      if (Platform.OS === 'android') {
        const problematicBrands = ['Huawei', 'Honor', 'Xiaomi', 'OnePlus', 'Oppo', 'Vivo', 'Realme']
        const brandMatch = problematicBrands.find(brand => 
          diagnostic.device.brand?.toLowerCase().includes(brand.toLowerCase()) ||
          diagnostic.device.manufacturer?.toLowerCase().includes(brand.toLowerCase())
        )

        if (brandMatch) {
          diagnostic.issues.push(`${brandMatch} device detected - may have aggressive battery optimization`)
          diagnostic.recommendations.push('Disable battery optimization for this app')
          diagnostic.recommendations.push('Enable auto-start for this app')
          diagnostic.recommendations.push('Add app to protected apps list')
        }

        const androidVersion = parseInt(diagnostic.device.osVersion?.split('.')[0] || '0')
        if (androidVersion >= 6) {
          diagnostic.recommendations.push('Ensure "Background App Refresh" is enabled')
          diagnostic.recommendations.push('Check "Do Not Disturb" settings')
        }
      }

      console.log('📊 [PUSH] Notification diagnostic results:', diagnostic)
      return diagnostic

    } catch (error) {
      console.error('❌ [PUSH] Diagnostic failed:', error)
      diagnostic.issues.push(`Diagnostic error: ${error.message}`)
      return diagnostic
    }
  }
  async getPermissionStatus() {
    try {
      const { status } = await Notifications.getPermissionsAsync()
      return status
    } catch (error) {
      console.error('❌ [PUSH] Error getting permission status:', error)
      return 'undetermined'
    }
  }

  // Start automated notification monitoring
  startAutomatedMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
    }

    console.log('🤖 [PUSH] Starting automated notification monitoring...')
    
    // Perform health check every 30 minutes
    this.monitoringInterval = setInterval(async () => {
      try {
        console.log('🔄 [PUSH] Performing scheduled health check...')
        const healthReport = await this.performNotificationHealthCheck()
        
        // If health is poor and automatic remediation failed, emit alert
        if (healthReport.overall === 'requires_attention') {
          this.emit('healthAlert', {
            report: healthReport,
            timestamp: Date.now(),
            type: 'scheduled_check'
          })
        }
        
        // Update health metrics for debugging
        await this.updateHealthMetrics(healthReport)
        
      } catch (error) {
        console.error('❌ [PUSH] Scheduled health check failed:', error)
      }
    }, 30 * 60 * 1000) // 30 minutes

    // Check token validity daily and refresh if needed
    this.tokenCheckInterval = setInterval(async () => {
      try {
        if (this.pushToken) {
          console.log('🔍 [PUSH] Performing daily token validation...')
          const isValid = await this.validatePushTokenWithExpoPing(this.pushToken)
          
          if (!isValid) {
            console.log('⚠️ [PUSH] Daily token check failed, refreshing...')
            await this.refreshPushTokenWithValidation()
          } else {
            console.log('✅ [PUSH] Daily token validation passed')
          }
        }
      } catch (error) {
        console.error('❌ [PUSH] Daily token check failed:', error)
      }
    }, 24 * 60 * 60 * 1000) // 24 hours

    // Monitor app state changes for immediate health checks
    this.appStateSubscription = AppState.addEventListener('change', async (nextAppState) => {
      if (nextAppState === 'active' && this.lastAppState !== 'active') {
        console.log('📱 [PUSH] App became active, performing health check...')
        
        // Brief delay to allow app to fully activate
        setTimeout(async () => {
          const healthReport = await this.performNotificationHealthCheck()
          
          if (healthReport.overall !== 'healthy') {
            this.emit('appActivationHealthIssue', {
              report: healthReport,
              timestamp: Date.now()
            })
          }
        }, 2000)
      }
      
      this.lastAppState = nextAppState
    })

    console.log('✅ [PUSH] Automated monitoring started')
  }

  // Stop automated monitoring
  stopAutomatedMonitoring() {
    console.log('⏹️ [PUSH] Stopping automated monitoring...')
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
      this.monitoringInterval = null
    }
    
    if (this.tokenCheckInterval) {
      clearInterval(this.tokenCheckInterval)
      this.tokenCheckInterval = null
    }
    
    if (this.appStateSubscription) {
      this.appStateSubscription.remove()
      this.appStateSubscription = null
    }
    
    console.log('✅ [PUSH] Automated monitoring stopped')
  }

  // Update health metrics for debugging and analytics
  async updateHealthMetrics(healthReport) {
    try {
      const metrics = {
        timestamp: healthReport.timestamp,
        overall: healthReport.overall,
        permissions_healthy: healthReport.permissions?.healthy || false,
        token_healthy: healthReport.token?.healthy || false,
        channels_healthy: healthReport.channels?.healthy || true, // Default true for iOS
        device_severity: healthReport.device?.severity || 'none',
        remediation_count: healthReport.remediation?.length || 0
      }

      // Store in AsyncStorage for debugging (keep last 50 reports)
      const existingMetrics = JSON.parse(await AsyncStorage.getItem('notificationHealthMetrics') || '[]')
      existingMetrics.push(metrics)
      
      // Keep only last 50 reports
      if (existingMetrics.length > 50) {
        existingMetrics.splice(0, existingMetrics.length - 50)
      }
      
      await AsyncStorage.setItem('notificationHealthMetrics', JSON.stringify(existingMetrics))
      
      // Emit metrics for external tracking
      this.emit('healthMetricsUpdated', metrics)
      
    } catch (error) {
      console.error('❌ [PUSH] Failed to update health metrics:', error)
    }
  }

  // Get health metrics for debugging
  async getHealthMetrics() {
    try {
      const metrics = JSON.parse(await AsyncStorage.getItem('notificationHealthMetrics') || '[]')
      return metrics
    } catch (error) {
      console.error('❌ [PUSH] Failed to get health metrics:', error)
      return []
    }
  }

  // Clear health metrics
  async clearHealthMetrics() {
    try {
      await AsyncStorage.removeItem('notificationHealthMetrics')
      console.log('✅ [PUSH] Health metrics cleared')
    } catch (error) {
      console.error('❌ [PUSH] Failed to clear health metrics:', error)
    }
  }

  // Force complete notification system reset (nuclear option)
  async performCompleteSystemReset() {
    try {
      console.log('💥 [PUSH] Performing complete notification system reset...')
      
      // Stop monitoring
      this.stopAutomatedMonitoring()
      
      // Clear all stored data
      await AsyncStorage.multiRemove([
        PUSH_TOKEN_KEY, 
        'notificationHealthMetrics',
        'deviceCompatibilityCache'
      ])
      
      // Reset internal state
      this.pushToken = null
      this.isInitialized = false
      
      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      // Recreate notification channels (Android)
      if (Platform.OS === 'android') {
        await this.setupProductionNotificationChannels()
      }
      
      // Re-request permissions
      await this.requestPermissions()
      
      // Generate new token
      await this.getOrRegisterPushToken()
      
      // Restart monitoring
      this.startAutomatedMonitoring()
      
      console.log('✅ [PUSH] Complete system reset completed')
      
      // Emit reset completion
      this.emit('systemReset', {
        timestamp: Date.now(),
        success: true
      })
      
      return true
      
    } catch (error) {
      console.error('❌ [PUSH] Complete system reset failed:', error)
      
      this.emit('systemReset', {
        timestamp: Date.now(),
        success: false,
        error: error.message
      })
      
      return false
    }
  }

  // Present a local notification (used by FCM service)
  async presentLocalNotification({ title, body, data = {} }) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data,
          sound: 'default',
        },
        trigger: null, // null means show immediately
      })
      console.log('✅ [PUSH] Local notification presented:', title)
    } catch (error) {
      console.error('❌ [PUSH] Error presenting local notification:', error)
    }
  }

  // Handle FCM token refresh
  handleFCMTokenRefresh(token) {
    console.log('🔥 [PUSH] FCM token refreshed:', token)
    this.fcmToken = token
    // Could trigger token validation or update here if needed
  }

  // Navigate to chat (placeholder for navigation logic)
  navigateToChat({ userId, userPseudo }) {
    console.log('🧭 [PUSH] Navigate to chat requested:', { userId, userPseudo })
    // Navigation logic would be implemented by the UI layer
    // This is just a placeholder for the FCM service
  }
}

// Clear notifications for a specific sender/conversation
async function clearNotificationsForSender(senderId) {
  try {
    console.log(`🔔 [PUSH] Clearing notifications for sender: ${senderId}`)
    
    // Get all delivered notifications
    const deliveredNotifications = await Notifications.getPresentedNotificationsAsync()
    console.log(`🔔 [PUSH] Found ${deliveredNotifications.length} delivered notifications`)
    
    // Find notifications from this sender
    const notificationsToCancel = deliveredNotifications.filter(notification => {
      const data = notification.request?.content?.data
      return data && (data.senderId === senderId || data.userId === senderId)
    })
    
    console.log(`🔔 [PUSH] Found ${notificationsToCancel.length} notifications to clear for sender ${senderId}`)
    
    // Cancel each notification
    for (const notification of notificationsToCancel) {
      try {
        await Notifications.dismissNotificationAsync(notification.request.identifier)
        console.log(`🔔 [PUSH] Dismissed notification: ${notification.request.identifier}`)
      } catch (error) {
        console.error(`❌ [PUSH] Error dismissing notification ${notification.request.identifier}:`, error)
      }
    }
    
    // Also clear badge count (iOS)
    if (Platform.OS === 'ios') {
      await Notifications.setBadgeCountAsync(0)
      console.log(`🔔 [PUSH] Cleared badge count`)
    }
    
    console.log(`✅ [PUSH] Successfully cleared notifications for sender: ${senderId}`)
    
  } catch (error) {
    console.error(`❌ [PUSH] Error clearing notifications for sender ${senderId}:`, error)
  }
}

// Helper function to check if user is currently in chat with sender
async function checkIfInChatWithSender(senderId) {
  try {
    // Import chat visibility service to check if user is currently viewing chat or home screen
    const { chatVisibilityService } = await import('./chatVisibilityService')
    
    // Use comprehensive suppression logic that considers both chat and home screen visibility
    const shouldSuppress = chatVisibilityService.shouldSuppressNotifications(senderId)
    
    if (shouldSuppress) {
      const reason = chatVisibilityService.isViewingChatWith(senderId) 
        ? `viewing chat with sender ${senderId}`
        : 'viewing home screen with real-time updates'
      console.log(`👁️ [PUSH] User is currently ${reason}, suppressing notification`)
    }
    
    return shouldSuppress
  } catch (error) {
    console.error('❌ [PUSH] Error checking notification suppression:', error)
    // Fallback to false to ensure notifications are still sent on error
    return false
  }
}

// Export singleton instance
export const pushNotificationService = new PushNotificationService()

// Export types for TypeScript users
export const NotificationTypes = {
  MESSAGE: 'message',
  SYSTEM: 'system',
  FRIEND_REQUEST: 'friend_request'
}

export const NotificationPriority = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high'
}
