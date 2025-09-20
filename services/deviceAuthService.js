import Constants from 'expo-constants'
import { clearUserData, getOrCreateDeviceId, getUserData, saveUserData } from '../utils/secureStore'
import { supabase } from './supabaseClient'

const SUPABASE_URL = Constants.expoConfig?.extra?.supabaseUrl
const SUPABASE_ANON_KEY = Constants.expoConfig?.extra?.supabaseAnonKey

/**
 * Device-bound JWT Authentication Service
 * 
 * This service implements secure device-bound authentication where:
 * - Each device gets a unique device_id
 * - Users are bound to their device (1 user ↔ 1 device)
 * - JWTs contain both user_id (sub) and device_id (dev_id) claims
 * - All security is enforced at the database level via RLS
 */

export class DeviceAuthService {
  // PATCH 6: Increase session cache TTL from 30s to 10 minutes
  static _cachedSession = null
  static _sessionCacheTime = 0
  static _sessionCacheTTL = 10 * 60 * 1000 // 10 minutes (increased from 30 seconds)
  
  /**
   * Get cached session or fetch fresh one
   */
  static async getSession() {
    const now = Date.now()
    
    // Return cached session if fresh
    if (this._cachedSession && (now - this._sessionCacheTime) < this._sessionCacheTTL) {
      return this._cachedSession
    }
    
    try {
      const { data: { session }, error } = await supabase.auth.getSession()
      
      // Cache the session result
      this._cachedSession = session
      this._sessionCacheTime = now
      
      return session
    } catch (error) {
      console.error('Error getting session:', error)
      return null
    }
  }
  
  /**
   * Clear session cache when needed
   */
  static clearSessionCache() {
    this._cachedSession = null
    this._sessionCacheTime = 0
  }
  
  /**
   * Register a new user with device-bound authentication
   */
  static async register(pseudo, age, sexe = 'Autre') {
    try {
      // IMPORTANT: Clear all existing app data for fresh start
      const { clearAllAppData } = await import('../utils/secureStore')
      await clearAllAppData()
      
      const deviceId = await getOrCreateDeviceId()
      
      const response = await fetch(`${SUPABASE_URL}/functions/v1/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, // Use anon key for edge function
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

      // Handle the response based on session type
      if (data.manual_session) {
        // Session creation failed on server, authenticate manually using user ID
        console.log('Manual session required, signing in with user ID:', data.auth_user_id)
        
        // Try to sign in the user manually using the created auth user
        // Use the email returned from the registration function
        const authEmail = data.auth_email;
        
        console.log('Manual session creation: Using returned email:', authEmail);
        
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: `${deviceId.slice(-16)}DeviceAuth!` // Match the password format in register function
        })
        
        if (signInError) {
          console.log('Manual sign-in failed, but user was created. You can implement manual session handling here.')
          // For now, just store the user data and return success
          await saveUserData(data.user)
          
          return {
            user: data.user,
            session: null, // No session available
            manual_auth: true
          }
        }
      } else {
        // Normal session creation worked
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token
        })

        if (sessionError) {
          throw new Error('Failed to establish session: ' + sessionError.message)
        }
      }

      // Store user data locally (Supabase session is now managed automatically)
      await saveUserData(data.user)

      // Initialize notifications with fresh start for new account
      try {
        const { pushNotificationService } = await import('./pushNotificationService')
        console.log('🔔 [AUTH] Initializing notifications for new account...')
        await pushNotificationService.initializeForNewAccount(data.user.id)
      } catch (notifError) {
        console.error('⚠️ [AUTH] Failed to initialize notifications for new account:', notifError)
        // Don't fail registration if notifications fail, but log it
      }

      return {
        user: data.user,
        session: {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          token_type: data.token_type,
          expires_in: data.expires_in
        }
      }
    } catch (error) {
      console.error('DeviceAuthService.register error:', error)
      throw error
    }
  }

  /**
   * Initialize authentication on app start
   * Checks for existing session and validates it, or tries to restore from stored data
   */
  static async initialize() {
    try {
      // OPTIMIZATION: Use cached session to avoid redundant auth calls
      const session = await this.getSession()
      
      if (session) {
        // We have a valid session, get user profile
        const { data: userProfile, error: profileError } = await supabase
          .from('users')
          .select('*')
          .eq('id', session.user.id)
          .single()

        if (!profileError && userProfile) {
          await saveUserData(userProfile)
          
          // Initialize notifications for authenticated user
          try {
            const { notificationIntegration } = await import('./notificationIntegration')
            await notificationIntegration.init(userProfile)
          } catch (notifError) {
            console.error('⚠️ [AUTH] Failed to initialize notifications:', notifError)
            // Don't fail auth if notifications fail
          }
          
          return userProfile
        }
      }

      // No valid session, check if we have stored user data from manual auth
      const storedUser = await getUserData()
      if (storedUser) {
        console.log('Found stored user data, attempting to restore session for user:', storedUser.id)
        
        // Try to create a session using refresh token approach
        try {
          const deviceId = await getOrCreateDeviceId()
          
          // Try to get a fresh token using our refresh endpoint
          const response = await fetch(`${SUPABASE_URL}/functions/v1/refresh-token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
              user_id: storedUser.id,
              device_id: deviceId
            })
          })

          if (response.ok) {
            const data = await response.json()
            
            // Try to set the session
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: data.access_token,
              refresh_token: data.refresh_token
            })

            if (!sessionError) {
              console.log('Successfully restored session for user:', storedUser.pseudo)
              await saveUserData(data.user)
              return data.user
            }
          }
        } catch (refreshError) {
          console.log('Could not refresh session, but user data exists:', refreshError.message)
        }

        // If session restoration failed but we have stored user data, validate the user still exists
        console.log('Session restoration failed, validating stored user still exists in database')
        
        try {
          // Validate that the user still exists in the database
          const { data: userExists, error: validationError } = await supabase
            .from('users')
            .select('id, pseudo, device_id')
            .eq('id', storedUser.id)
            .eq('device_id', await getOrCreateDeviceId())
            .single()

          if (validationError || !userExists) {
            console.log('Stored user no longer exists in database or device mismatch, clearing local data')
            await clearUserData()
            return null
          }

          console.log('User validation successful, using stored user data without session for user:', storedUser.pseudo)
          return storedUser
          
        } catch (validationError) {
          console.log('User validation failed, clearing local data:', validationError.message)
          await clearUserData()
          return null
        }
      }

      // No session and no stored data, user needs to register/login
      console.log('No valid session or stored user data found')
      return null
      
    } catch (error) {
      console.error('DeviceAuthService.initialize error:', error)
      
      // If there's an error, validate stored user data before returning it as fallback
      try {
        const storedUser = await getUserData()
        if (storedUser) {
          console.log('Error during initialization, validating stored user before fallback')
          
          // Validate that the user still exists in the database
          const { data: userExists, error: validationError } = await supabase
            .from('users')
            .select('id')
            .eq('id', storedUser.id)
            .eq('device_id', await getOrCreateDeviceId())
            .single()

          if (!validationError && userExists) {
            console.log('Fallback user validation successful')
            return storedUser
          } else {
            console.log('Fallback user validation failed, clearing local data')
            await clearUserData()
          }
        }
      } catch (fallbackError) {
        console.error('Fallback user data retrieval failed:', fallbackError)
        await clearUserData()
      }
      
      return null
    }
  }

  /**
   * Refresh the access token
   */
  static async refreshToken() {
    try {
      const deviceId = await getOrCreateDeviceId()
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session?.refresh_token) {
        throw new Error('No refresh token available')
      }

      const response = await fetch(`${SUPABASE_URL}/functions/v1/refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          refresh_token: session.refresh_token,
          device_id: deviceId
        })
      })

      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || 'Token refresh failed')
      }

      // Update the session in Supabase
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token
      })

      if (sessionError) {
        throw new Error('Failed to update session: ' + sessionError.message)
      }

      // Fetch fresh user data from database to get updated push token
      console.log('🔄 [AUTH] Fetching fresh user data after token refresh...')
      const { data: freshUserData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', data.user.id)
        .single()

      if (userError) {
        console.error('❌ [AUTH] Error fetching fresh user data:', userError)
        // Fall back to the user data from the token refresh
        await saveUserData(data.user)
        return data.user
      }

      // Update stored user data with fresh data
      await saveUserData(freshUserData)
      console.log('✅ [AUTH] Fresh user data fetched and stored')

      return freshUserData
    } catch (error) {
      console.error('DeviceAuthService.refreshToken error:', error)
      throw error
    }
  }

  /**
   * Logout and clear all authentication data
   */
  static async logout() {
    try {
      // OPTIMIZATION: Clear session cache
      this.clearSessionCache()
      
      // Clear Supabase session
      await supabase.auth.signOut()
      
      // Clear local storage
      await clearUserData()
    } catch (error) {
      console.error('DeviceAuthService.logout error:', error)
      // Even if there's an error, still clear local data and cache
      this.clearSessionCache()
      await clearUserData()
    }
  }

  /**
   * Complete account deletion with logout
   * Deletes user from database, auth, and all related media
   */
  static async deleteAccountAndLogout() {
    try {
      console.log('🗑️ Starting complete account deletion...')
      
      // Get current user before deletion
      const { data: { user } } = await supabase.auth.getUser()
      const userData = await getUserData()
      
      if (!user || !userData) {
        console.warn('⚠️ No user found for deletion')
        await this.logout() // Still logout if no user data
        return { success: true, message: 'No user data to delete' }
      }

      console.log('🗑️ Deleting account for user:', userData.pseudo, 'ID:', userData.id)

      // 1. Clear local media cache (server deletion handled by database)
      try {
        console.log('🗑️ Clearing local media cache...')
        const { unifiedMediaService } = await import('./unifiedMediaService')
        unifiedMediaService.clearCache()
        console.log('✅ Local media cache cleared successfully')
      } catch (mediaError) {
        console.error('❌ Error clearing media cache:', mediaError)
        // Continue with deletion even if cache clearing fails
      }

      // 2. Clear all local caches and real-time subscriptions
      try {
        console.log('🗑️ Clearing all local caches and real-time subscriptions...')
        const { default: CacheService } = await import('./cacheService')
        
        // Clear individual cache types instead of 'all' to avoid AsyncStorage issues
        try {
          CacheService.clear('signedUrl')
          CacheService.clear('user') 
          CacheService.clear('conversation')
          CacheService.clear('message')
          console.log('✅ All individual caches cleared successfully')
        } catch (cacheServiceError) {
          console.error('❌ Error with CacheService clearing:', cacheServiceError)
          // Try clearing AsyncStorage directly with error handling
          // BUT PRESERVE blocked users data
          try {
            const AsyncStorage = require('@react-native-async-storage/async-storage').default
            
            // Get all keys and preserve blocked users data
            const allKeys = await AsyncStorage.getAllKeys()
            const blockedUsersKeys = allKeys.filter(key => 
              key === 'blocked_users' || key === 'blocked_users_details'
            )
            
            // Backup blocked users data
            let blockedUsersBackup = {}
            for (const key of blockedUsersKeys) {
              const value = await AsyncStorage.getItem(key)
              if (value) {
                blockedUsersBackup[key] = value
              }
            }
            
            // Clear everything
            await AsyncStorage.clear()
            console.log('✅ AsyncStorage cleared directly')
            
            // Restore blocked users data
            for (const [key, value] of Object.entries(blockedUsersBackup)) {
              await AsyncStorage.setItem(key, value)
            }
            console.log('✅ Blocked users data preserved during clear')
            
          } catch (asyncStorageError) {
            console.warn('⚠️ AsyncStorage clear failed (this is often normal during deletion):', asyncStorageError.message)
          }
        }
        
        // Also cleanup real-time cache manager with better error handling
        try {
          const { realtimeCacheManager } = await import('./realtimeCacheManager')
          if (realtimeCacheManager && typeof realtimeCacheManager.cleanupForAccountDeletion === 'function') {
            await realtimeCacheManager.cleanupForAccountDeletion()
            console.log('✅ Real-time cache manager cleaned up successfully')
          } else {
            console.log('ℹ️ Real-time cache manager not available or no cleanup method')
          }
        } catch (rtCacheError) {
          console.error('❌ Error with real-time cache cleanup:', rtCacheError.message)
          // Try manual cleanup if available
          try {
            const { realtimeCacheManager } = await import('./realtimeCacheManager')
            if (realtimeCacheManager && typeof realtimeCacheManager.cleanup === 'function') {
              realtimeCacheManager.cleanup()
              console.log('✅ Manual real-time cache cleanup completed')
            }
          } catch (manualCleanupError) {
            console.log('ℹ️ Manual real-time cache cleanup also failed, continuing...')
          }
        }
        
        console.log('✅ Local caches and real-time subscriptions cleared successfully')
      } catch (cacheError) {
        console.error('❌ Error clearing caches:', cacheError)
      }

      // 3. Delete all messages involving this user from database
      try {
        console.log('🗑️ Deleting all user messages from database...')
        const { error: deleteMessagesError } = await supabase
          .from('messages')
          .delete()
          .or(`sender_id.eq.${userData.id},receiver_id.eq.${userData.id}`)
        
        if (deleteMessagesError) {
          console.error('❌ Error deleting messages:', deleteMessagesError)
          // Continue with deletion even if message deletion fails
        } else {
          console.log('✅ User messages deleted successfully')
        }
      } catch (messageError) {
        console.error('❌ Error in message deletion:', messageError)
      }

      // 4. Delete user record from database (BEFORE auth deletion to maintain permissions)
      try {
        console.log('🗑️ Deleting user record from database...')
        
        // First verify the user exists
        const { data: existingUser, error: checkError } = await supabase
          .from('users')
          .select('id, pseudo')
          .eq('id', userData.id)
          .single()
        
        if (checkError && checkError.code !== 'PGRST116') {
          console.error('❌ Error checking user existence:', checkError)
          throw new Error(`Failed to verify user existence: ${checkError.message}`)
        }
        
        if (!existingUser) {
          console.log('ℹ️ User record already deleted from database')
        } else {
          console.log(`🗑️ Attempting to delete user ${existingUser.pseudo} (${existingUser.id}) from database...`)
          
          // Try using the new delete_user_account function first
          try {
            const { data: rpcResult, error: rpcError } = await supabase
              .rpc('delete_user_account', { user_id: userData.id })
            
            if (rpcError) {
              console.error('❌ RPC deletion failed:', rpcError)
              // Fall back to direct deletion
              throw rpcError
            }
            
            if (rpcResult?.success) {
              console.log('✅ User record deleted successfully from database via RPC:', rpcResult.message)
              if (rpcResult.messages_deleted > 0) {
                console.log(`✅ Also deleted ${rpcResult.messages_deleted} associated messages`)
              }
            } else {
              console.error('❌ RPC deletion returned failure:', rpcResult)
              throw new Error(`RPC deletion failed: ${rpcResult?.error || 'Unknown error'}`)
            }
          } catch (rpcError) {
            console.error('❌ RPC deletion method failed:', rpcError.message)
            
            // Fall back to direct deletion
            console.log('🔧 Attempting direct deletion as fallback...')
            const { data: deletedRows, error: deleteUserError } = await supabase
              .from('users')
              .delete()
              .eq('id', userData.id)
              .select()
            
            if (deleteUserError) {
              console.error('❌ Direct deletion failed:', deleteUserError)
              
              // If it's an RLS policy error, log it specifically
              if (deleteUserError.code === '42501' || deleteUserError.message.includes('policy')) {
                console.error('❌ Row Level Security policy is preventing deletion')
                console.log('🔧 This might require database admin intervention or RLS policy adjustment')
              }
              
              throw deleteUserError
            }
            
            // Verify deletion actually happened
            if (deletedRows && deletedRows.length > 0) {
              console.log('✅ User record deleted successfully from database:', deletedRows[0].pseudo)
            } else {
              console.error('❌ User deletion returned no rows - deletion may have failed')
              
              // Double-check if user still exists
              const { data: stillExists } = await supabase
                .from('users')
                .select('id')
                .eq('id', userData.id)
                .single()
              
              if (stillExists) {
                throw new Error('User deletion failed - user still exists in database')
              } else {
                console.log('✅ User confirmed deleted (verification query returned no results)')
              }
            }
          }
        }
      } catch (userError) {
        console.error('❌ Error in user deletion:', userError)
        // Critical error - don't continue with auth deletion if database deletion failed
        throw new Error(`Database user deletion failed: ${userError.message}`)
      }

      // 5. Delete user from Supabase auth (after database deletion)
      let authDeletionSuccess = false
      try {
        console.log('🗑️ Deleting user from Supabase auth...')
        
        // Get the current session to use the access token
        const { data: { session } } = await supabase.auth.getSession()
        const authToken = session?.access_token
        
        if (!authToken) {
          console.warn('⚠️ No auth token available for user deletion')
        } else {
          // Try using Edge Function for auth user deletion first
          try {
            console.log('🗑️ Trying auth deletion via Edge Function...')
            const { data: functionResult, error: functionError } = await supabase.functions.invoke('delete-user', {
              body: { user_id: userData.id },
              headers: {
                'Authorization': `Bearer ${authToken}`
              }
            })
            
            if (functionError) {
              console.error('❌ Error deleting auth user via function:', functionError)
            } else if (functionResult?.success) {
              console.log('✅ User deleted from Supabase auth via function')
              authDeletionSuccess = true
            } else {
              console.error('❌ Function call failed:', functionResult)
            }
          } catch (functionCallError) {
            console.error('❌ Error calling delete function:', functionCallError)
          }
        }
        
        // Only try RPC function if Edge Function failed
        if (!authDeletionSuccess) {
          try {
            console.log('🗑️ Trying auth deletion via RPC function as fallback...')
            const { data: rpcResult, error: authDeleteError } = await supabase.rpc('delete_auth_user', {
              user_id: userData.id
            })
            
            if (authDeleteError) {
              console.error('❌ Error deleting auth user via RPC:', authDeleteError)
            } else if (rpcResult?.success) {
              console.log('✅ User deleted from Supabase auth via RPC')
              authDeletionSuccess = true
            } else {
              console.error('❌ RPC call failed:', rpcResult)
            }
          } catch (rpcError) {
            console.error('❌ Error in RPC auth deletion:', rpcError)
          }
        } else {
          console.log('ℹ️ Skipping RPC deletion since Edge Function succeeded')
        }
        
      } catch (authError) {
        console.error('❌ Error in auth user deletion:', authError)
      }

      // 6. Sign out from Supabase (cleanup after deletion)
      try {
        console.log('🗑️ Signing out from Supabase...')
        await supabase.auth.signOut()
        console.log('✅ Successfully signed out from Supabase')
      } catch (signOutError) {
        console.log('ℹ️ Sign out error (expected after user deletion):', signOutError.message)
      }

      // 7. Clear all local storage and session data
      try {
        console.log('🗑️ Clearing all local storage...')
        await clearUserData()
        
        // Also clear any device-specific data
        const { getOrCreateDeviceId } = await import('../utils/secureStore')
        const deviceId = await getOrCreateDeviceId()
        
        // Import AsyncStorage dynamically to avoid issues
        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default
        await AsyncStorage.multiRemove([
          `userData_${deviceId}`,
          'user_data',
          'device_id',
          'auth_token',
          'refresh_token'
        ])
        
        console.log('✅ Local storage cleared successfully')
      } catch (storageError) {
        console.error('❌ Error clearing local storage:', storageError)
      }

      // 8. Final cleanup - ensure sign out
      try {
        await supabase.auth.signOut()
      } catch (signOutError) {
        console.log('ℹ️ Final sign out error (expected after user deletion):', signOutError.message)
      }

      console.log('🎉 Account deletion completed successfully')
      return { 
        success: true, 
        message: 'Account deleted successfully',
        deletedUser: userData.pseudo 
      }

    } catch (error) {
      console.error('❌ DeviceAuthService.deleteAccountAndLogout error:', error)
      
      // Even if there's an error, still try to logout
      try {
        await this.logout()
      } catch (logoutError) {
        console.error('❌ Error during fallback logout:', logoutError)
      }
      
      throw new Error(`Account deletion failed: ${error.message}`)
    }
  }

  /**
   * Get the current authenticated user
   */
  static async getCurrentUser() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        return null
      }

      const userData = await getUserData()
      return userData
    } catch (error) {
      console.error('DeviceAuthService.getCurrentUser error:', error)
      return null
    }
  }

  /**
   * Check if user is authenticated
   */
  static async isAuthenticated() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      return !!session
    } catch (error) {
      return false
    }
  }

  /**
   * Get the current session
   */
  static async getSession() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      return session
    } catch (error) {
      return null
    }
  }

  /**
   * Refresh the current session and update realtime auth
   * CRITICAL: Call this after every token refresh for realtime to work
   */
  static async refreshSession() {
    try {
      const { data: { session }, error } = await supabase.auth.refreshSession()
      
      if (error) {
        console.error('Session refresh failed:', error)
        return null
      }

      if (session) {
        console.log('🔄 Session refreshed successfully')
        
        // CRITICAL: Update realtime auth with new access token
        if (typeof window !== 'undefined') {
          // Only import if we're in a React Native environment
          const { productionRealtimeService } = await import('./productionRealtimeService')
          await productionRealtimeService.refreshAuthToken()
        }
      }

      return session
    } catch (error) {
      console.error('Error refreshing session:', error)
      return null
    }
  }

  /**
   * Setup automatic session refresh
   */
  static setupSessionRefresh() {
    // Listen for auth state changes
    supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('🔔 Auth state changed:', event)
      
      if (event === 'TOKEN_REFRESHED' && session) {
        console.log('🔄 Token refreshed, updating realtime auth')
        
        try {
          // Update realtime auth with new token
          if (typeof window !== 'undefined') {
            const { productionRealtimeService } = await import('./productionRealtimeService')
            await productionRealtimeService.refreshAuthToken()
          }
        } catch (error) {
          console.error('Error updating realtime auth after token refresh:', error)
        }
      }
    })
  }
}

// Legacy exports for backward compatibility
export const createUser = DeviceAuthService.register
export const getCurrentUser = DeviceAuthService.getCurrentUser
