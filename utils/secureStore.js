import * as Device from 'expo-device'
import * as SecureStore from 'expo-secure-store'

const DEVICE_ID_KEY = 'notext_device_id'
const USER_DATA_KEY = 'notext_user_data'
const CAMERA_TYPE_KEY = 'notext_camera_type'
const PREVIOUS_USER_KEY = 'notext_previous_user'
const AUTH_STATE_KEY = 'notext_auth_state'
const DEVICE_MIGRATION_KEY = 'notext_device_migration'

// Génère un device ID unique
const generateDeviceId = () => {
  const timestamp = Date.now().toString()
  const random = Math.random().toString(36).substring(2)
  const random2 = Math.random().toString(36).substring(2) // Additional randomness
  const deviceInfo = Device.osName || 'unknown'
  const deviceModel = Device.modelName || 'unknown'
  const deviceId = Device.deviceName || 'unknown'
  
  // Create a more unique ID with multiple sources of entropy
  const uniqueParts = [
    deviceInfo,
    deviceModel.replace(/\s+/g, ''), // Remove spaces
    deviceId.replace(/\s+/g, ''), // Remove spaces
    timestamp,
    random,
    random2
  ]
  
  return uniqueParts.join('_')
}

export const getOrCreateDeviceId = async () => {
  try {
    let deviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY)
    if (!deviceId) {
      deviceId = generateDeviceId()
      await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId)
    }
    return deviceId
  } catch (error) {
    return generateDeviceId()
  }
}

export const saveUserData = async (userData) => {
  try {
    await SecureStore.setItemAsync(USER_DATA_KEY, JSON.stringify(userData))
  } catch (error) {
  }
}

export const getUserData = async () => {
  try {
    const data = await SecureStore.getItemAsync(USER_DATA_KEY)
    return data ? JSON.parse(data) : null
  } catch (error) {
    return null
  }
}

export const clearUserData = async () => {
  try {
    await SecureStore.deleteItemAsync(USER_DATA_KEY)
    await SecureStore.deleteItemAsync(DEVICE_ID_KEY)
  } catch (error) {
  }
}

// Complete cache and data cleanup for fresh account creation
export const clearAllAppData = async () => {
  try {
    console.log('🧹 [SECURE_STORE] Starting complete app data cleanup...')
    
    // Clear secure store items
    await SecureStore.deleteItemAsync(USER_DATA_KEY)
    await SecureStore.deleteItemAsync(DEVICE_ID_KEY)
    await SecureStore.deleteItemAsync(CAMERA_TYPE_KEY)
    
    // Clear AsyncStorage items that might contain old data
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default
    
    const keysToRemove = [
      // Push notification related
      '@NoText:pushToken',
      'notificationHealthMetrics',
      'deviceCompatibilityCache',
      
      // User and auth related
      'userData',
      'user_data',
      'auth_token',
      'refresh_token',
      'session_data',
      
      // Message and chat related
      'messagesCache',
      'conversationsCache',
      'chatStore',
      'unreadCounts',
      
      // Media and cache related
      'imageCache',
      'videoCache',
      'mediaCache',
      'thumbnailCache',
      
      // App state and settings
      'appSettings',
      'notificationSettings',
      'cameraSettings',
      'performanceMetrics',
      
      // Any prefixed keys (device specific)
    ]
    
    // Remove known keys
    await AsyncStorage.multiRemove(keysToRemove)
    
    // Get all keys and remove any that match our app patterns
    const allKeys = await AsyncStorage.getAllKeys()
    const appKeys = allKeys.filter(key => 
      key.includes('@NoText') || 
      key.includes('notext') || 
      key.includes('userData') ||
      key.includes('device_id') ||
      key.includes('pushToken') ||
      key.includes('Cache') ||
      key.includes('notification') ||
      key.includes('message') ||
      key.includes('conversation') ||
      key.includes('chat')
    )
    
    if (appKeys.length > 0) {
      console.log(`🧹 [SECURE_STORE] Removing ${appKeys.length} app-specific keys`)
      await AsyncStorage.multiRemove(appKeys)
    }
    
    console.log('✅ [SECURE_STORE] Complete app data cleanup completed')
    
  } catch (error) {
    console.error('❌ [SECURE_STORE] Error during complete cleanup:', error)
  }
}

// Function to clear just the device ID for testing
export const clearDeviceId = async () => {
  try {
    await SecureStore.deleteItemAsync(DEVICE_ID_KEY)
  } catch (error) {
  }
}

// Camera type preference functions
export const saveCameraType = async (cameraType) => {
  try {
    await SecureStore.setItemAsync(CAMERA_TYPE_KEY, cameraType)
  } catch (error) {
    console.error('Failed to save camera type:', error)
  }
}

export const getCameraType = async () => {
  try {
    const cameraType = await SecureStore.getItemAsync(CAMERA_TYPE_KEY)
    return cameraType || 'back' // Default to 'back' if no preference saved
  } catch (error) {
    console.error('Failed to get camera type:', error)
    return 'back' // Default to 'back' on error
  }
}

// Auth state persistence for robust authentication
export const saveAuthState = async (authState) => {
  try {
    await SecureStore.setItemAsync(AUTH_STATE_KEY, JSON.stringify({
      ...authState,
      lastUpdated: Date.now()
    }))
  } catch (error) {
    console.error('Failed to save auth state:', error)
  }
}

export const getAuthState = async () => {
  try {
    const data = await SecureStore.getItemAsync(AUTH_STATE_KEY)
    return data ? JSON.parse(data) : null
  } catch (error) {
    console.error('Failed to get auth state:', error)
    return null
  }
}

export const clearAuthState = async () => {
  try {
    await SecureStore.deleteItemAsync(AUTH_STATE_KEY)
  } catch (error) {
    console.error('Failed to clear auth state:', error)
  }
}

// Previous user data for recovery
export const savePreviousUser = async (userData) => {
  try {
    await SecureStore.setItemAsync(PREVIOUS_USER_KEY, JSON.stringify({
      ...userData,
      savedAt: Date.now()
    }))
  } catch (error) {
    console.error('Failed to save previous user:', error)
  }
}

export const getPreviousUser = async () => {
  try {
    const data = await SecureStore.getItemAsync(PREVIOUS_USER_KEY)
    return data ? JSON.parse(data) : null
  } catch (error) {
    console.error('Failed to get previous user:', error)
    return null
  }
}

export const clearPreviousUser = async () => {
  try {
    await SecureStore.deleteItemAsync(PREVIOUS_USER_KEY)
  } catch (error) {
    console.error('Failed to clear previous user:', error)
  }
}

// Device migration tracking
export const saveDeviceMigration = async (migrationData) => {
  try {
    await SecureStore.setItemAsync(DEVICE_MIGRATION_KEY, JSON.stringify({
      ...migrationData,
      timestamp: Date.now()
    }))
  } catch (error) {
    console.error('Failed to save device migration data:', error)
  }
}

export const getDeviceMigration = async () => {
  try {
    const data = await SecureStore.getItemAsync(DEVICE_MIGRATION_KEY)
    return data ? JSON.parse(data) : null
  } catch (error) {
    console.error('Failed to get device migration data:', error)
    return null
  }
}

export const clearDeviceMigration = async () => {
  try {
    await SecureStore.deleteItemAsync(DEVICE_MIGRATION_KEY)
  } catch (error) {
    console.error('Failed to clear device migration data:', error)
  }
}

// Enhanced device ID generation with migration support
export const getOrCreateDeviceIdWithMigration = async (forceNew = false) => {
  try {
    let deviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY)
    
    if (!deviceId || forceNew) {
      // Check if we have migration data from previous device ID
      const migrationData = await getDeviceMigration()
      
      if (migrationData && !forceNew) {
        console.log('🔄 [DEVICE] Found migration data, generating new device ID with migration info')
        deviceId = generateDeviceId()
        
        // Update migration data with new device ID
        await saveDeviceMigration({
          ...migrationData,
          newDeviceId: deviceId,
          migrationCompleted: false
        })
      } else {
        deviceId = generateDeviceId()
      }
      
      await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId)
    }
    
    return deviceId
  } catch (error) {
    console.error('Failed to get device ID with migration:', error)
    return generateDeviceId()
  }
}

// Detect if device ID has changed and handle migration
export const handleDeviceIdMigration = async () => {
  try {
    const userData = await getUserData()
    if (!userData) return null
    
    const currentDeviceId = await getOrCreateDeviceId()
    const storedDeviceId = userData.device_id
    
    if (storedDeviceId && storedDeviceId !== currentDeviceId) {
      console.log('🔄 [DEVICE] Device ID change detected!')
      console.log('📱 [DEVICE] Stored device ID:', storedDeviceId)
      console.log('📱 [DEVICE] Current device ID:', currentDeviceId)
      
      // Save migration information
      await saveDeviceMigration({
        userId: userData.id,
        pseudo: userData.pseudo,
        oldDeviceId: storedDeviceId,
        newDeviceId: currentDeviceId,
        detectedAt: Date.now(),
        migrationAttempted: false,
        migrationCompleted: false
      })
      
      return {
        detected: true,
        oldDeviceId: storedDeviceId,
        newDeviceId: currentDeviceId,
        userData
      }
    }
    
    return { detected: false }
  } catch (error) {
    console.error('❌ [DEVICE] Error detecting device ID migration:', error)
    return { detected: false, error }
  }
}

// Check if user can be automatically migrated
export const canAutoMigrateUser = async (userData) => {
  try {
    if (!userData?.id || !userData?.pseudo) return false
    
    const migrationData = await getDeviceMigration()
    
    // Can auto-migrate if:
    // 1. We have migration data for this user
    // 2. Migration was attempted but not completed
    // 3. The stored user matches the migration data
    return migrationData && 
           migrationData.userId === userData.id &&
           migrationData.pseudo === userData.pseudo &&
           !migrationData.migrationCompleted
  } catch (error) {
    console.error('❌ [DEVICE] Error checking auto-migration eligibility:', error)
    return false
  }
}
