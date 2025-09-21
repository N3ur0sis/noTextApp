import Constants from 'expo-constants'
import { clearUserData, getOrCreateDeviceId, getOrCreateDeviceIdWithMigration, getUserData, saveUserData, getAuthState, saveAuthState, clearAuthState, getPreviousUser, savePreviousUser, getDeviceMigration, saveDeviceMigration } from '../utils/secureStore'
import { supabase } from './supabaseClient'
import { NetworkService } from './networkService'

const SUPABASE_URL = Constants.expoConfig?.extra?.supabaseUrl
const SUPABASE_ANON_KEY = Constants.expoConfig?.extra?.supabaseAnonKey

/**
 * Enhanced Device-bound JWT Authentication Service with Robust Offline Support
 * 
 * This enhanced service provides:
 * - Proper offline detection and handling
 * - Automatic reconnection when connectivity is restored
 * - Graceful handling of device ID changes
 * - Smart pseudo collision detection and recovery
 * - Persistent auth state management
 * - No unnecessary logouts due to network issues
 */

export class RobustDeviceAuthService {
  // Session cache with longer TTL for better offline experience
  static _cachedSession = null
  static _sessionCacheTime = 0
  static _sessionCacheTTL = 15 * 60 * 1000 // 15 minutes
  static _isInitialized = false
  static _connectionListener = null
  static _authState = null
  
  // Auth state enum
  static AUTH_STATES = {
    OFFLINE_AUTHENTICATED: 'offline_authenticated',
    ONLINE_AUTHENTICATED: 'online_authenticated', 
    UNAUTHENTICATED: 'unauthenticated',
    AUTHENTICATING: 'authenticating',
    CONNECTION_RECOVERING: 'connection_recovering'
  }

  /**
   * Initialize the robust authentication system
   */
  static async initialize() {
    if (this._isInitialized) {
      return this._authState?.user || null
    }

    try {
      console.log('🛡️ [ROBUST_AUTH] Initializing robust authentication system...')
      
      // Initialize network service
      await NetworkService.initialize()
      
      // Setup connection monitoring
      this._setupConnectionMonitoring()
      
      // Load previous auth state
      this._authState = await getAuthState() || { 
        state: this.AUTH_STATES.UNAUTHENTICATED, 
        user: null,
        lastOnlineSync: 0
      }
      
      // Check network connectivity
      const isConnected = await NetworkService.isConnected()
      console.log('🌐 [ROBUST_AUTH] Network connectivity:', isConnected)
      
      if (isConnected) {
        return await this._initializeOnline()
      } else {
        return await this._initializeOffline()
      }
    } catch (error) {
      console.error('❌ [ROBUST_AUTH] Initialization failed:', error)
      return await this._handleInitializationFailure(error)
    } finally {
      this._isInitialized = true
    }
  }

  /**
   * Online initialization - try to authenticate with server
   */
  static async _initializeOnline() {
    try {
      console.log('🟢 [ROBUST_AUTH] Initializing in online mode...')
      
      // Try to get current session
      const session = await this._getSessionSafely()
      
      if (session?.user) {
        // We have a valid session, get user profile
        const userProfile = await this._getUserProfile(session.user.id)
        
        if (userProfile) {
          const authState = {
            state: this.AUTH_STATES.ONLINE_AUTHENTICATED,
            user: userProfile,
            lastOnlineSync: Date.now()
          }
          
          await this._updateAuthState(authState)
          await saveUserData(userProfile)
          await savePreviousUser(userProfile)
          
          console.log('✅ [ROBUST_AUTH] Online authentication successful for user:', userProfile.pseudo)
          return userProfile
        }
      }
      
      // No valid session, check if we have stored user data for recovery
      const storedUser = await getUserData()
      if (storedUser) {
        console.log('🔄 [ROBUST_AUTH] Attempting to restore session for stored user:', storedUser.pseudo)
        
        const recoveredUser = await this._attemptSessionRecovery(storedUser)
        if (recoveredUser) {
          return recoveredUser
        }
        
        // Session recovery failed, but user exists - handle device ID changes
        const migratedUser = await this._handleDeviceIdMigration(storedUser)
        if (migratedUser) {
          return migratedUser
        }
      }
      
      // Check for previous user for pseudo collision handling
      const previousUser = await getPreviousUser()
      if (previousUser) {
        console.log('📝 [ROBUST_AUTH] Previous user found for potential collision handling:', previousUser.pseudo)
      }
      
      // No authentication possible, set unauthenticated state
      const authState = { state: this.AUTH_STATES.UNAUTHENTICATED, user: null, lastOnlineSync: 0 }
      await this._updateAuthState(authState)
      
      console.log('🔓 [ROBUST_AUTH] No valid authentication found - user needs to register/login')
      return null
      
    } catch (error) {
      console.error('❌ [ROBUST_AUTH] Online initialization failed:', error)
      // Fall back to offline mode
      return await this._initializeOffline()
    }
  }

  /**
   * Offline initialization - use locally stored auth data
   */
  static async _initializeOffline() {
    try {
      console.log('🔴 [ROBUST_AUTH] Initializing in offline mode...')
      
      const storedUser = await getUserData()
      if (storedUser) {
        const authState = {
          state: this.AUTH_STATES.OFFLINE_AUTHENTICATED,
          user: storedUser,
          lastOnlineSync: this._authState?.lastOnlineSync || 0
        }
        
        await this._updateAuthState(authState)
        
        console.log('✅ [ROBUST_AUTH] Offline authentication using stored user:', storedUser.pseudo)
        console.log('⏱️ [ROBUST_AUTH] Last online sync:', new Date(authState.lastOnlineSync).toISOString())
        
        return storedUser
      }
      
      // No stored user data available
      const authState = { state: this.AUTH_STATES.UNAUTHENTICATED, user: null, lastOnlineSync: 0 }
      await this._updateAuthState(authState)
      
      console.log('🔓 [ROBUST_AUTH] No offline user data available')
      return null
      
    } catch (error) {
      console.error('❌ [ROBUST_AUTH] Offline initialization failed:', error)
      return null
    }
  }

  /**
   * Handle initialization failure gracefully
   */
  static async _handleInitializationFailure(error) {
    console.warn('⚠️ [ROBUST_AUTH] Handling initialization failure gracefully')
    
    try {
      // Try to use any stored user data as fallback
      const storedUser = await getUserData()
      if (storedUser) {
        const authState = {
          state: this.AUTH_STATES.OFFLINE_AUTHENTICATED,
          user: storedUser,
          lastOnlineSync: 0 // Mark as never synced online due to error
        }
        
        await this._updateAuthState(authState)
        
        console.log('🛡️ [ROBUST_AUTH] Fallback authentication using stored user:', storedUser.pseudo)
        return storedUser
      }
    } catch (fallbackError) {
      console.error('❌ [ROBUST_AUTH] Even fallback authentication failed:', fallbackError)
    }
    
    return null
  }

  /**
   * Setup connection monitoring to handle reconnection
   */
  static _setupConnectionMonitoring() {
    if (this._connectionListener) return
    
    this._connectionListener = NetworkService.addConnectionListener(async (isConnected) => {
      console.log('🌐 [ROBUST_AUTH] Connection state changed:', isConnected)
      
      if (isConnected && this._authState?.state === this.AUTH_STATES.OFFLINE_AUTHENTICATED) {
        console.log('🔄 [ROBUST_AUTH] Connection restored, attempting to sync authentication...')
        await this._handleConnectionRestore()
      }
    })
  }

  /**
   * Handle connection restoration
   */
  static async _handleConnectionRestore() {
    try {
      const currentUser = this._authState?.user
      if (!currentUser) return
      
      console.log('🔄 [ROBUST_AUTH] Syncing authentication after connection restore for user:', currentUser.pseudo)
      
      // Update state to show we're recovering connection
      const recoveringState = {
        ...this._authState,
        state: this.AUTH_STATES.CONNECTION_RECOVERING
      }
      await this._updateAuthState(recoveringState)
      
      // Try to restore/refresh session
      const recoveredUser = await this._attemptSessionRecovery(currentUser)
      
      if (recoveredUser) {
        console.log('✅ [ROBUST_AUTH] Authentication synced successfully after connection restore')
      } else {
        console.log('⚠️ [ROBUST_AUTH] Could not sync authentication, staying in offline mode')
        // Revert to offline authenticated state
        const offlineState = {
          ...this._authState,
          state: this.AUTH_STATES.OFFLINE_AUTHENTICATED
        }
        await this._updateAuthState(offlineState)
      }
      
    } catch (error) {
      console.error('❌ [ROBUST_AUTH] Error during connection restore:', error)
      // Revert to offline state on error
      if (this._authState?.user) {
        const offlineState = {
          ...this._authState,
          state: this.AUTH_STATES.OFFLINE_AUTHENTICATED
        }
        await this._updateAuthState(offlineState)
      }
    }
  }

  /**
   * Attempt to recover/restore session for user
   */
  static async _attemptSessionRecovery(user) {
    try {
      console.log('🔄 [ROBUST_AUTH] Attempting session recovery for user:', user.pseudo)
      
      const deviceId = await getOrCreateDeviceId()
      
      // Try to refresh token using existing session
      const session = await this._getSessionSafely()
      if (session?.refresh_token) {
        console.log('🔑 [ROBUST_AUTH] Found existing refresh token, attempting refresh...')
        
        const refreshedUser = await this._refreshTokenWithFallback(session.refresh_token, deviceId)
        if (refreshedUser) {
          const authState = {
            state: this.AUTH_STATES.ONLINE_AUTHENTICATED,
            user: refreshedUser,
            lastOnlineSync: Date.now()
          }
          
          await this._updateAuthState(authState)
          await saveUserData(refreshedUser)
          await savePreviousUser(refreshedUser)
          
          console.log('✅ [ROBUST_AUTH] Session recovery successful via refresh token')
          return refreshedUser
        }
      }
      
      // Try to create new session using stored user data
      console.log('🔑 [ROBUST_AUTH] Attempting new session creation...')
      const response = await fetch(`${SUPABASE_URL}/functions/v1/refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          user_id: user.id,
          device_id: deviceId
        })
      })
      
      if (response.ok) {
        const data = await response.json()
        
        // Set the new session
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token
        })
        
        if (!sessionError) {
          const authState = {
            state: this.AUTH_STATES.ONLINE_AUTHENTICATED,
            user: data.user,
            lastOnlineSync: Date.now()
          }
          
          await this._updateAuthState(authState)
          await saveUserData(data.user)
          await savePreviousUser(data.user)
          
          console.log('✅ [ROBUST_AUTH] Session recovery successful via new session')
          return data.user
        }
      }
      
      console.log('⚠️ [ROBUST_AUTH] Session recovery failed, but user data is still valid')
      return null
      
    } catch (error) {
      console.error('❌ [ROBUST_AUTH] Session recovery failed:', error)
      return null
    }
  }

  /**
   * Handle device ID migration scenarios
   */
  static async _handleDeviceIdMigration(storedUser) {
    try {
      console.log('🔄 [ROBUST_AUTH] Checking for device ID migration for user:', storedUser.pseudo)
      
      // Check if user exists in database with a different device ID
      const { data: existingUsers, error } = await supabase
        .from('users')
        .select('id, pseudo, device_id')
        .eq('id', storedUser.id)
      
      if (error || !existingUsers?.length) {
        console.log('❌ [ROBUST_AUTH] User not found in database, may have been deleted')
        return null
      }
      
      const dbUser = existingUsers[0]
      const currentDeviceId = await getOrCreateDeviceId()
      
      if (dbUser.device_id !== currentDeviceId) {
        console.log('🔄 [ROBUST_AUTH] Device ID mismatch detected, attempting migration...')
        console.log('📱 [ROBUST_AUTH] Stored device ID:', dbUser.device_id)
        console.log('📱 [ROBUST_AUTH] Current device ID:', currentDeviceId)
        
        // Save migration info
        await saveDeviceMigration({
          userId: storedUser.id,
          pseudo: storedUser.pseudo,
          oldDeviceId: dbUser.device_id,
          newDeviceId: currentDeviceId,
          migrationAttempted: true
        })
        
        // Try to update device ID in database using the refresh-token endpoint
        const response = await fetch(`${SUPABASE_URL}/functions/v1/refresh-token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            user_id: storedUser.id,
            old_device_id: dbUser.device_id,
            new_device_id: currentDeviceId
          })
        })
        
        if (response.ok) {
          const migrationResult = await response.json()
          
          if (migrationResult.success) {
            console.log('✅ [ROBUST_AUTH] Device ID migration successful')
            
            // Try to create session with new device ID
            const recoveredUser = await this._attemptSessionRecovery(storedUser)
            if (recoveredUser) {
              return recoveredUser
            }
          }
        }
        
        console.log('⚠️ [ROBUST_AUTH] Device ID migration failed, but user data exists')
      }
      
      return null
      
    } catch (error) {
      console.error('❌ [ROBUST_AUTH] Device ID migration failed:', error)
      return null
    }
  }

  /**
   * Enhanced registration with offline resilience
   */
  static async register(pseudo, age, sexe = 'Autre') {
    try {
      console.log('📝 [ROBUST_AUTH] Starting robust registration for pseudo:', pseudo)
      
      // Set authenticating state
      const authenticatingState = { 
        state: this.AUTH_STATES.AUTHENTICATING, 
        user: null,
        lastOnlineSync: 0 
      }
      await this._updateAuthState(authenticatingState)
      
      // Check network connectivity
      const isConnected = await NetworkService.isConnected()
      
      if (!isConnected) {
        throw new Error('Pas de connexion internet. Veuillez vérifier votre connexion et réessayer.')
      }
      
      // Check if pseudo was used before on this device
      const previousUser = await getPreviousUser()
      if (previousUser && previousUser.pseudo.toLowerCase() === pseudo.toLowerCase()) {
        console.log('🔄 [ROBUST_AUTH] Pseudo collision detected, attempting recovery...')
        
        const recoveredUser = await this._handlePseudoCollisionRecovery(previousUser, pseudo, age, sexe)
        if (recoveredUser) {
          return recoveredUser
        }
      }
      
      // Clear all existing app data for fresh start
      const { clearAllAppData } = await import('../utils/secureStore')
      await clearAllAppData()
      
      const deviceId = await getOrCreateDeviceId()
      
      // Attempt registration (no retry for pseudo collision)
      const registrationResult = await this._attemptRegistration(pseudo, age, sexe, deviceId)
      
      // Handle session creation
      let sessionResult = null
      
      if (registrationResult.manual_session) {
        sessionResult = await this._handleManualSessionCreation(registrationResult, deviceId)
      } else {
        sessionResult = await this._handleNormalSessionCreation(registrationResult)
      }
      
      // Store user data and update auth state
      await saveUserData(registrationResult.user)
      await savePreviousUser(registrationResult.user)
      
      const authState = {
        state: this.AUTH_STATES.ONLINE_AUTHENTICATED,
        user: registrationResult.user,
        lastOnlineSync: Date.now()
      }
      await this._updateAuthState(authState)
      
      // Initialize notifications for new account
      try {
        const { pushNotificationService } = await import('./pushNotificationService')
        await pushNotificationService.initializeForNewAccount(registrationResult.user.id)
      } catch (notifError) {
        console.error('⚠️ [ROBUST_AUTH] Failed to initialize notifications:', notifError)
      }
      
      console.log('✅ [ROBUST_AUTH] Registration successful for user:', registrationResult.user.pseudo)
      
      return {
        user: registrationResult.user,
        session: sessionResult,
        isNewAccount: true
      }
      
    } catch (error) {
      console.error('❌ [ROBUST_AUTH] Registration failed:', error)
      
      // Revert auth state on error
      const authState = { state: this.AUTH_STATES.UNAUTHENTICATED, user: null, lastOnlineSync: 0 }
      await this._updateAuthState(authState)
      
      throw error
    }
  }

  /**
   * Handle pseudo collision recovery
   */
  static async _handlePseudoCollisionRecovery(previousUser, pseudo, age, sexe) {
    try {
      console.log('🔄 [ROBUST_AUTH] Attempting pseudo collision recovery for:', pseudo)
      
      const currentDeviceId = await getOrCreateDeviceId()
      
      // Check if previous user exists in database with any device ID
      const { data: existingUsers, error } = await supabase
        .from('users')
        .select('*')
        .eq('pseudo', pseudo)
      
      if (error) {
        console.error('❌ [ROBUST_AUTH] Error checking existing users:', error)
        return null
      }
      
      if (existingUsers?.length > 0) {
        const existingUser = existingUsers[0]
        
        // Check if it's the same user by comparing stored user ID
        if (existingUser.id === previousUser.id) {
          console.log('✅ [ROBUST_AUTH] Pseudo collision resolved - same user, attempting reconnection...')
          
          // Try device ID migration if needed
          if (existingUser.device_id !== currentDeviceId) {
            console.log('🔄 [ROBUST_AUTH] Device ID changed, attempting migration...')
            const migratedUser = await this._handleDeviceIdMigration(existingUser)
            if (migratedUser) {
              return { user: migratedUser, session: null, isRecovery: true }
            }
          }
          
          // Try session recovery
          const recoveredUser = await this._attemptSessionRecovery(existingUser)
          if (recoveredUser) {
            return { user: recoveredUser, session: null, isRecovery: true }
          }
          
          // Use existing user data as fallback
          const authState = {
            state: this.AUTH_STATES.OFFLINE_AUTHENTICATED,
            user: existingUser,
            lastOnlineSync: 0
          }
          await this._updateAuthState(authState)
          await saveUserData(existingUser)
          
          console.log('✅ [ROBUST_AUTH] Pseudo collision resolved with offline mode')
          return { user: existingUser, session: null, isRecovery: true }
        } else {
          console.log('❌ [ROBUST_AUTH] Pseudo collision - different user owns this pseudo')
          throw new Error('Ce pseudo est déjà utilisé par un autre utilisateur.')
        }
      }
      
      console.log('🔄 [ROBUST_AUTH] Previous user not found in database, proceeding with normal registration')
      return null
      
    } catch (error) {
      console.error('❌ [ROBUST_AUTH] Pseudo collision recovery failed:', error)
      return null
    }
  }

  /**
   * Attempt registration with smart pseudo collision handling
   */
  static async _attemptRegistration(pseudo, age, sexe, deviceId) {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          pseudo: pseudo.trim(),
          age: parseInt(age),
          sexe: sexe || 'Autre',
          device_id: deviceId
        })
      })
      
      const data = await response.json()
      
      if (!response.ok) {
        // Check if this is a pseudo collision (pseudo already taken)
        if (data.error && data.error.includes('déjà pris')) {
          console.log('🔍 [ROBUST_AUTH] Pseudo collision detected, checking for existing account on this device...')
          
          // Check if we have a previous user with this pseudo
          const previousUser = await getPreviousUser()
          if (previousUser && previousUser.pseudo.toLowerCase() === pseudo.toLowerCase()) {
            console.log('🔄 [ROBUST_AUTH] Found previous user with same pseudo, attempting recovery...')
            const recoveredUser = await this._handlePseudoCollisionRecovery(previousUser, pseudo, age, sexe)
            if (recoveredUser) {
              return recoveredUser
            }
          }
          
          // Check if existing user in DB matches this device ID
          const { data: existingUsers } = await supabase
            .from('users')
            .select('*')
            .eq('pseudo', pseudo)
            .eq('device_id', deviceId)
          
          if (existingUsers && existingUsers.length > 0) {
            console.log('🔄 [ROBUST_AUTH] Found existing user with same device ID, attempting recovery...')
            const existingUser = existingUsers[0]
            const recoveredUser = await this._handlePseudoCollisionRecovery(existingUser, pseudo, age, sexe)
            if (recoveredUser) {
              return recoveredUser
            }
          }
          
          // No recovery possible, this pseudo is truly taken by another device
          throw new Error(`Le pseudo "${pseudo}" est déjà utilisé par un autre appareil`)
        }
        
        // For other errors, use network retry
        throw new Error(data.error || 'Registration failed')
      }
      
      return data
      
    } catch (error) {
      // If it's a genuine network error (not pseudo collision), retry with NetworkService
      if (!error.message.includes('déjà pris') && !error.message.includes('déjà utilisé')) {
        return await NetworkService.withRetry(async () => {
          const response = await fetch(`${SUPABASE_URL}/functions/v1/register`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
              pseudo: pseudo.trim(),
              age: parseInt(age),
              sexe: sexe || 'Autre',
              device_id: deviceId
            })
          })
          
          const data = await response.json()
          
          if (!response.ok) {
            throw new Error(data.error || 'Registration failed')
          }
          
          return data
        }, 2, 2000) // Only 2 retries for network errors
      }
      
      // Re-throw pseudo collision and other non-network errors
      throw error
    }
  }

  /**
   * Handle manual session creation
   */
  static async _handleManualSessionCreation(registrationResult, deviceId) {
    try {
      console.log('🔑 [ROBUST_AUTH] Handling manual session creation...')
      
      const authEmail = registrationResult.auth_email
      
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: `${deviceId.slice(-16)}DeviceAuth!`
      })
      
      if (signInError) {
        console.warn('⚠️ [ROBUST_AUTH] Manual sign-in failed, using stored user data only')
        return null
      }
      
      console.log('✅ [ROBUST_AUTH] Manual session creation successful')
      return signInData.session
      
    } catch (error) {
      console.error('❌ [ROBUST_AUTH] Manual session creation failed:', error)
      return null
    }
  }

  /**
   * Handle normal session creation
   */
  static async _handleNormalSessionCreation(registrationResult) {
    try {
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: registrationResult.access_token,
        refresh_token: registrationResult.refresh_token
      })
      
      if (sessionError) {
        console.warn('⚠️ [ROBUST_AUTH] Normal session creation failed:', sessionError)
        return null
      }
      
      console.log('✅ [ROBUST_AUTH] Normal session creation successful')
      return {
        access_token: registrationResult.access_token,
        refresh_token: registrationResult.refresh_token,
        token_type: registrationResult.token_type,
        expires_in: registrationResult.expires_in
      }
      
    } catch (error) {
      console.error('❌ [ROBUST_AUTH] Normal session creation failed:', error)
      return null
    }
  }

  /**
   * Enhanced logout that preserves user data for recovery
   */
  static async logout(clearAllData = false) {
    try {
      console.log('🚪 [ROBUST_AUTH] Performing logout, clearAllData:', clearAllData)
      
      const currentUser = this._authState?.user
      
      // Clear session cache and Supabase session
      this.clearSessionCache()
      
      try {
        await supabase.auth.signOut()
      } catch (signOutError) {
        console.warn('⚠️ [ROBUST_AUTH] Supabase sign out failed:', signOutError)
      }
      
      if (clearAllData) {
        // Complete cleanup - user initiated logout
        await clearUserData()
        await clearAuthState()
        await clearPreviousUser()
      } else {
        // Preserve user data for recovery - system initiated logout
        if (currentUser) {
          await savePreviousUser(currentUser)
        }
      }
      
      // Update auth state
      const authState = { 
        state: this.AUTH_STATES.UNAUTHENTICATED, 
        user: null, 
        lastOnlineSync: clearAllData ? 0 : (this._authState?.lastOnlineSync || 0)
      }
      await this._updateAuthState(authState)
      
      console.log('✅ [ROBUST_AUTH] Logout completed')
      
    } catch (error) {
      console.error('❌ [ROBUST_AUTH] Logout failed:', error)
    }
  }

  /**
   * Enhanced refresh token with fallback handling
   */
  static async refreshToken() {
    try {
      const isConnected = await NetworkService.isConnected()
      
      if (!isConnected) {
        console.log('🔴 [ROBUST_AUTH] Cannot refresh token - offline mode')
        
        // Return stored user data in offline mode
        const storedUser = await getUserData()
        if (storedUser && this._authState?.state === this.AUTH_STATES.OFFLINE_AUTHENTICATED) {
          return storedUser
        }
        
        throw new Error('No internet connection and no offline user data available')
      }
      
      const deviceId = await getOrCreateDeviceId()
      const session = await this._getSessionSafely()
      
      if (!session?.refresh_token) {
        throw new Error('No refresh token available')
      }
      
      const refreshedUser = await this._refreshTokenWithFallback(session.refresh_token, deviceId)
      
      if (refreshedUser) {
        const authState = {
          state: this.AUTH_STATES.ONLINE_AUTHENTICATED,
          user: refreshedUser,
          lastOnlineSync: Date.now()
        }
        
        await this._updateAuthState(authState)
        await saveUserData(refreshedUser)
        
        return refreshedUser
      }
      
      throw new Error('Token refresh failed')
      
    } catch (error) {
      console.error('❌ [ROBUST_AUTH] Token refresh failed:', error)
      
      // Fall back to stored user data if available
      const storedUser = await getUserData()
      if (storedUser) {
        console.log('🛡️ [ROBUST_AUTH] Using stored user data as fallback')
        
        const authState = {
          ...this._authState,
          state: this.AUTH_STATES.OFFLINE_AUTHENTICATED
        }
        await this._updateAuthState(authState)
        
        return storedUser
      }
      
      throw error
    }
  }

  /**
   * Helper method to refresh token with fallback
   */
  static async _refreshTokenWithFallback(refreshToken, deviceId) {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          refresh_token: refreshToken,
          device_id: deviceId
        })
      })
      
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || 'Token refresh failed')
      }
      
      // Update session
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token
      })
      
      if (sessionError) {
        throw new Error('Failed to update session: ' + sessionError.message)
      }
      
      return data.user
      
    } catch (error) {
      console.error('❌ [ROBUST_AUTH] Token refresh with fallback failed:', error)
      return null
    }
  }

  /**
   * Get user profile safely
   */
  static async _getUserProfile(userId) {
    try {
      const { data: userProfile, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single()
      
      if (error || !userProfile) {
        console.error('❌ [ROBUST_AUTH] Error fetching user profile:', error)
        return null
      }
      
      return userProfile
      
    } catch (error) {
      console.error('❌ [ROBUST_AUTH] Exception getting user profile:', error)
      return null
    }
  }

  /**
   * Get session safely without throwing errors
   */
  static async _getSessionSafely() {
    try {
      const now = Date.now()
      
      // Return cached session if fresh
      if (this._cachedSession && (now - this._sessionCacheTime) < this._sessionCacheTTL) {
        return this._cachedSession
      }
      
      const { data: { session }, error } = await supabase.auth.getSession()
      
      if (error) {
        console.warn('⚠️ [ROBUST_AUTH] Error getting session:', error)
        return null
      }
      
      // Cache the session result
      this._cachedSession = session
      this._sessionCacheTime = now
      
      return session
      
    } catch (error) {
      console.error('❌ [ROBUST_AUTH] Exception getting session:', error)
      return null
    }
  }

  /**
   * Update and persist auth state
   */
  static async _updateAuthState(newState) {
    this._authState = newState
    await saveAuthState(newState)
    console.log('🔄 [ROBUST_AUTH] Auth state updated:', newState.state, newState.user?.pseudo || 'no user')
  }

  /**
   * Clear session cache
   */
  static clearSessionCache() {
    this._cachedSession = null
    this._sessionCacheTime = 0
  }

  /**
   * Get current auth state
   */
  static getCurrentAuthState() {
    return {
      ...this._authState,
      isOnline: this._authState?.state === this.AUTH_STATES.ONLINE_AUTHENTICATED,
      isOffline: this._authState?.state === this.AUTH_STATES.OFFLINE_AUTHENTICATED,
      isAuthenticated: this._authState?.state === this.AUTH_STATES.ONLINE_AUTHENTICATED || 
                      this._authState?.state === this.AUTH_STATES.OFFLINE_AUTHENTICATED,
      isAuthenticating: this._authState?.state === this.AUTH_STATES.AUTHENTICATING,
      isRecovering: this._authState?.state === this.AUTH_STATES.CONNECTION_RECOVERING
    }
  }

  /**
   * Check if user is authenticated (online or offline)
   */
  static isAuthenticated() {
    return this.getCurrentAuthState().isAuthenticated
  }

  /**
   * Get current user
   */
  static getCurrentUser() {
    return this._authState?.user || null
  }

  /**
   * Cleanup method
   */
  static cleanup() {
    if (this._connectionListener) {
      this._connectionListener()
      this._connectionListener = null
    }
    
    this._isInitialized = false
    this._authState = null
    this.clearSessionCache()
  }
}