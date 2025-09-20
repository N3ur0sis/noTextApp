import React, { createContext, useContext, useEffect, useState } from 'react'
import { DeviceAuthService } from '../services/deviceAuthService'

// AuthContext to provide user state globally with device-bound JWT authentication
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    initializeAuth()
    
    // Listen for account deletion events
    const setupAccountDeletionListener = async () => {
      try {
        const { realtimeCacheManager } = await import('../services/realtimeCacheManager')
        
        const handleAccountDeleted = (data) => {
          console.log('🗑️ [AUTH] Account deletion detected, cleaning up auth state')
          setUser(null)
          setError(null)
          setLoading(false)
        }
        
        realtimeCacheManager.on('accountDeleted', handleAccountDeleted)
        
        // Cleanup listener on unmount
        return () => {
          realtimeCacheManager.off('accountDeleted', handleAccountDeleted)
        }
      } catch (error) {
        console.error('❌ Error setting up account deletion listener:', error)
      }
    }
    
    setupAccountDeletionListener()
  }, [])

  const initializeAuth = async () => {
    try {
      setLoading(true)
      
      // GARANTIE: Installation propre - nettoyer TOUT cache de notifications existant
      try {
        const { pushNotificationService } = await import('../services/pushNotificationService')
        await pushNotificationService.ensureCleanInstallation()
        console.log('✅ [AUTH] Clean installation guaranteed for push notifications')
      } catch (cleanError) {
        console.warn('⚠️ [AUTH] Could not ensure clean installation:', cleanError)
      }
      
      const currentUser = await DeviceAuthService.initialize()
      setUser(currentUser)
      setError(null)
      
      // CRITICAL FIX: Initialize realtimeCacheManager with the current user
      if (currentUser?.id) {
        console.log('🔄 [AUTH] Initializing realtimeCacheManager for user:', currentUser.id)
        try {
          const { realtimeCacheManager } = await import('../services/realtimeCacheManager')
          await realtimeCacheManager.initialize(currentUser.id)
          console.log('✅ [AUTH] RealtimeCacheManager initialized successfully')
        } catch (realtimeError) {
          console.error('❌ [AUTH] Failed to initialize realtimeCacheManager:', realtimeError)
          // Don't fail auth if realtime fails, but log it
        }

        // Initialize notifications after successful auth verification using robust manager
        console.log('📱 [AUTH] Initializing notifications for authenticated user:', currentUser.id)
        try {
          const { notificationManager } = await import('../services/notificationManager')
          await notificationManager.initialize(currentUser)
          console.log('✅ [AUTH] Notifications initialized for authenticated user via manager')

          // CRITICAL FIX: Refresh user data after notification initialization to get updated push token
          console.log('🔄 [AUTH] Refreshing user data after notification initialization...')
          try {
            // Small delay to ensure database update is committed
            await new Promise(resolve => setTimeout(resolve, 1000))
            const refreshedUser = await DeviceAuthService.refreshToken()
            setUser(refreshedUser)
            console.log('✅ [AUTH] User data refreshed after notification initialization')
          } catch (refreshError) {
            console.warn('⚠️ [AUTH] Could not refresh user data after notification init:', refreshError.message)
            // Don't fail if refresh fails, just log it
          }
        } catch (notifError) {
          console.error('❌ [AUTH] Failed to initialize notifications via manager on auth init:', notifError)
        }
      }
    } catch (err) {
      console.error('Auth initialization error:', err)
      setError(err.message)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  const login = async (userData, isNewAccount = false) => {
    setUser(userData)
    setError(null)
    
    // Initialize realtimeCacheManager for the logged-in user
    if (userData?.id) {
      console.log('🔄 [AUTH] Initializing realtimeCacheManager for logged-in user:', userData.id)
      try {
        const { realtimeCacheManager } = await import('../services/realtimeCacheManager')
        await realtimeCacheManager.initialize(userData.id)
        console.log('✅ [AUTH] RealtimeCacheManager initialized for logged-in user')
      } catch (realtimeError) {
        console.error('❌ [AUTH] Failed to initialize realtimeCacheManager on login:', realtimeError)
      }

              // Initialize notifications - use special method for new accounts
        if (isNewAccount) {
          console.log('🆕 [AUTH] Initializing notifications for NEW account:', userData.id)
          try {
            const { notificationManager } = await import('../services/notificationManager')
            await notificationManager.initializeForNewAccount(userData)
            console.log('✅ [AUTH] Notifications initialized for NEW account via manager')

            // CRITICAL FIX: Refresh user data after notification initialization to get updated push token
            console.log('🔄 [AUTH] Refreshing user data after new account notification initialization...')
            try {
              // Small delay to ensure database update is committed
              await new Promise(resolve => setTimeout(resolve, 1000))
              const refreshedUser = await DeviceAuthService.refreshToken()
              setUser(refreshedUser)
              console.log('✅ [AUTH] User data refreshed after new account notification initialization')
            } catch (refreshError) {
              console.warn('⚠️ [AUTH] Could not refresh user data after new account notification init:', refreshError.message)
              // Don't fail if refresh fails, just log it
            }
          } catch (notifError) {
            console.error('❌ [AUTH] Failed to initialize notifications for new account via manager:', notifError)
          }
        } else {
          console.log('📱 [AUTH] Initializing notifications for existing user:', userData.id)
          try {
            const { notificationManager } = await import('../services/notificationManager')
            await notificationManager.initialize(userData)
            console.log('✅ [AUTH] Notifications initialized for existing user via manager')

            // CRITICAL FIX: Refresh user data after notification initialization to get updated push token
            console.log('🔄 [AUTH] Refreshing user data after existing user notification initialization...')
            try {
              // Small delay to ensure database update is committed
              await new Promise(resolve => setTimeout(resolve, 1000))
              const refreshedUser = await DeviceAuthService.refreshToken()
              setUser(refreshedUser)
              console.log('✅ [AUTH] User data refreshed after existing user notification initialization')
            } catch (refreshError) {
              console.warn('⚠️ [AUTH] Could not refresh user data after existing user notification init:', refreshError.message)
              // Don't fail if refresh fails, just log it
            }
          } catch (notifError) {
            console.error('❌ [AUTH] Failed to initialize notifications via manager on login:', notifError)
          }
        }
    }
  }

  const logout = async () => {
    try {
      // Clean up realtimeCacheManager before logout
      if (user?.id) {
        console.log('🧹 [AUTH] Cleaning up realtimeCacheManager for user:', user.id)
        try {
          const { realtimeCacheManager } = await import('../services/realtimeCacheManager')
          realtimeCacheManager.cleanup()
          console.log('✅ [AUTH] RealtimeCacheManager cleaned up')
        } catch (realtimeError) {
          console.error('❌ [AUTH] Failed to cleanup realtimeCacheManager:', realtimeError)
        }

        // Clean up notifications before logout using manager
        console.log('🧹 [AUTH] Cleaning up notifications for user:', user.id)
        try {
          const { notificationManager } = await import('../services/notificationManager')
          await notificationManager.cleanup()
          console.log('✅ [AUTH] Notifications cleaned up via manager')
        } catch (notifError) {
          console.error('❌ [AUTH] Failed to cleanup notifications via manager:', notifError)
        }
      }
      
      await DeviceAuthService.logout()
      setUser(null)
      setError(null)
    } catch (err) {
      console.error('Logout error:', err)
      setError(err.message)
    }
  }

  const deleteAccount = async () => {
    try {
      setLoading(true)
      
      // Clean up realtimeCacheManager before account deletion
      if (user?.id) {
        console.log('🧹 [AUTH] Cleaning up realtimeCacheManager before account deletion for user:', user.id)
        try {
          const { realtimeCacheManager } = await import('../services/realtimeCacheManager')
          realtimeCacheManager.cleanup()
          console.log('✅ [AUTH] RealtimeCacheManager cleaned up before account deletion')
        } catch (realtimeError) {
          console.error('❌ [AUTH] Failed to cleanup realtimeCacheManager before deletion:', realtimeError)
        }
      }
      
      const result = await DeviceAuthService.deleteAccountAndLogout()
      setUser(null)
      setError(null)
      setLoading(false)
      return result
    } catch (err) {
      console.error('Delete account error:', err)
      setError(err.message)
      setLoading(false)
      throw err
    }
  }

  const refreshAuth = async () => {
    try {
      const refreshedUser = await DeviceAuthService.refreshToken()
      setUser(refreshedUser)
      setError(null)
      return refreshedUser
    } catch (err) {
      console.error('Auth refresh error:', err)
      setError(err.message)
      await logout() // If refresh fails, logout
      throw err
    }
  }

  const value = {
    user,
    loading,
    error,
    login,
    logout,
    deleteAccount,
    refreshAuth,
    isAuthenticated: !!user
  }
  
  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

// Hook to consume auth context
export function useAuthContext() {
  const context = useContext(AuthContext)
  console.log('🟡 [TRACE] useAuthContext hook', context);
  return context || { user: null, loading: true, error: null, isAuthenticated: false }
}

export default AuthContext
