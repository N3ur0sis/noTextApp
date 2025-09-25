import React, { createContext, useContext, useEffect, useState } from 'react'
import { DeviceAuthService } from '../services/deviceAuthService'
import { RobustDeviceAuthService } from '../services/robustDeviceAuthService'
import { NetworkService } from '../services/networkService'
import { AuthHealthMonitor } from '../services/authHealthMonitor'
import { ConnectionRecoveryService } from '../services/connectionRecoveryService'

// AuthContext to provide user state globally with enhanced robust device-bound JWT authentication
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [authState, setAuthState] = useState(null) // Enhanced auth state tracking
  const [connectionState, setConnectionState] = useState('unknown') // Network connection state

  useEffect(() => {
    initializeAuth()
    
    // Setup network monitoring
    setupNetworkMonitoring()
    
    // Listen for account deletion events
    const setupAccountDeletionListener = async () => {
      try {
        const { realtimeCacheManager } = await import('../services/realtimeCacheManager')
        
        const handleAccountDeleted = (data) => {
          console.log('🗑️ [AUTH] Account deletion detected, cleaning up auth state')
          setUser(null)
          setError(null)
          setLoading(false)
          setAuthState(null)
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

    // Cleanup on unmount
    return () => {
      RobustDeviceAuthService.cleanup()
      AuthHealthMonitor.stopMonitoring()
      ConnectionRecoveryService.stop()
    }
  }, [])

  const setupNetworkMonitoring = () => {
    // Monitor network changes
    NetworkService.addConnectionListener((isConnected) => {
      setConnectionState(isConnected ? 'connected' : 'disconnected')
      
      if (!isConnected) {
        console.log('🔴 [AUTH] Network disconnected - entering offline mode')
      } else {
        console.log('🟢 [AUTH] Network connected - attempting to sync auth state')
      }
    })
  }

  const initializeAuth = async () => {
    try {
      setLoading(true)
      setError(null)
      
      console.log('🛡️ [AUTH] Initializing enhanced robust authentication system...')
      
      // GARANTIE: Installation propre - nettoyer TOUT cache de notifications existant
      try {
        const { pushNotificationService } = await import('../services/pushNotificationService')
        await pushNotificationService.ensureCleanInstallation()
        console.log('✅ [AUTH] Clean installation guaranteed for push notifications')
      } catch (cleanError) {
        console.warn('⚠️ [AUTH] Could not ensure clean installation:', cleanError)
      }
      
      // Enhanced initialization with multiple recovery attempts
      let currentUser = null
      let currentAuthState = null
      
      // First attempt: Use the robust authentication service
      try {
        currentUser = await RobustDeviceAuthService.initialize()
        currentAuthState = RobustDeviceAuthService.getCurrentAuthState()
      } catch (initError) {
        console.warn('⚠️ [AUTH] First initialization attempt failed:', initError)
        
        // Second attempt: Try auto-recovery
        try {
          console.log('🔄 [AUTH] Attempting auto-recovery...')
          const recoveryResult = await RobustDeviceAuthService.attemptAutoRecovery()
          if (recoveryResult) {
            currentUser = recoveryResult.user
            currentAuthState = recoveryResult.authState
            console.log('✅ [AUTH] Auto-recovery successful')
          }
        } catch (recoveryError) {
          console.warn('⚠️ [AUTH] Auto-recovery failed:', recoveryError)
        }
      }
      
      setUser(currentUser)
      setAuthState(currentAuthState)
      setError(null)
      
      // Initialize additional services for authenticated users
      if (currentUser?.id) {
        console.log('🔄 [AUTH] Initializing services for authenticated user:', currentUser.id)
        
        // Only initialize services if we're online or have a recent online sync
        const shouldInitializeServices = currentAuthState.isOnline || 
          (currentAuthState.isOffline && currentAuthState.lastOnlineSync > (Date.now() - 24 * 60 * 60 * 1000)) // Less than 24 hours old
        
        if (shouldInitializeServices) {
          // Initialize realtimeCacheManager
          try {
            const { realtimeCacheManager } = await import('../services/realtimeCacheManager')
            await realtimeCacheManager.initialize(currentUser.id)
            console.log('✅ [AUTH] RealtimeCacheManager initialized successfully')
          } catch (realtimeError) {
            console.error('❌ [AUTH] Failed to initialize realtimeCacheManager:', realtimeError)
            // Don't fail auth if realtime fails in offline mode
            if (currentAuthState.isOnline) {
              console.warn('⚠️ [AUTH] Realtime init failed while online - this may affect functionality')
            }
          }

          // Initialize notifications for authenticated users
          if (currentAuthState.isOnline) {
            console.log('📱 [AUTH] Initializing notifications for authenticated user:', currentUser.id)
            try {
              const { notificationManager } = await import('../services/notificationManager')
              await notificationManager.initialize(currentUser)
              console.log('✅ [AUTH] Notifications initialized for authenticated user via manager')

              // Refresh user data after notification initialization only if online
              console.log('🔄 [AUTH] Refreshing user data after notification initialization...')
              try {
                await new Promise(resolve => setTimeout(resolve, 1000))
                const refreshedUser = await RobustDeviceAuthService.refreshToken()
                setUser(refreshedUser)
                console.log('✅ [AUTH] User data refreshed after notification initialization')
              } catch (refreshError) {
                console.warn('⚠️ [AUTH] Could not refresh user data after notification init:', refreshError.message)
                // Don't fail if refresh fails, just continue with current user data
              }
            } catch (notifError) {
              console.error('❌ [AUTH] Failed to initialize notifications via manager on auth init:', notifError)
              // Don't fail auth if notifications fail
            }
          } else {
            console.log('🔴 [AUTH] Skipping notification initialization in offline mode')
          }
        } else {
          console.log('🔴 [AUTH] Skipping service initialization - offline mode with stale data')
        }
      }

      // Start auth health monitoring and connection recovery if we have an authenticated user
      if (currentUser?.id) {
        console.log('❤️ [AUTH] Starting authentication health monitoring')
        AuthHealthMonitor.startMonitoring(120000) // Check every 2 minutes
        
        console.log('🔌 [AUTH] Starting connection recovery service')
        ConnectionRecoveryService.start()
      }
    } catch (err) {
      console.error('❌ [AUTH] Enhanced auth initialization error:', err)
      setError(err.message)
      setUser(null)
      setAuthState(null)
      
      // Don't immediately fail - try to use any stored user data as fallback
      try {
        const { getUserData } = await import('../utils/secureStore')
        const fallbackUser = await getUserData()
        
        if (fallbackUser) {
          console.log('🛡️ [AUTH] Using fallback user data due to initialization error:', fallbackUser.pseudo)
          setUser(fallbackUser)
          setAuthState({
            state: RobustDeviceAuthService.AUTH_STATES.OFFLINE_AUTHENTICATED,
            user: fallbackUser,
            lastOnlineSync: 0,
            isOffline: true,
            isAuthenticated: true
          })
          setError(null) // Clear error since we have fallback data
        }
      } catch (fallbackError) {
        console.error('❌ [AUTH] Even fallback user data failed:', fallbackError)
      }
    } finally {
      setLoading(false)
    }
  }

  const login = async (userData, isNewAccount = false) => {
    console.log('🔑 [AUTH] Enhanced login for user:', userData?.pseudo, 'isNewAccount:', isNewAccount)
    
    setUser(userData)
    setError(null)
    
    // Update auth state
    const currentAuthState = RobustDeviceAuthService.getCurrentAuthState()
    setAuthState(currentAuthState)
    
    // Initialize services for the logged-in user
    if (userData?.id) {
      console.log('🔄 [AUTH] Initializing services for logged-in user:', userData.id)
      
      // Initialize realtimeCacheManager
      try {
        const { realtimeCacheManager } = await import('../services/realtimeCacheManager')
        await realtimeCacheManager.initialize(userData.id)
        console.log('✅ [AUTH] RealtimeCacheManager initialized for logged-in user')
      } catch (realtimeError) {
        console.error('❌ [AUTH] Failed to initialize realtimeCacheManager on login:', realtimeError)
        // Don't fail login if realtime init fails
      }

      // For new accounts, notifications are already initialized by RobustDeviceAuthService
      // Just ensure notification manager is aware of the new user
      if (isNewAccount) {
        console.log('🆕 [AUTH] Setting up notification manager for NEW account:', userData.id)
        try {
          const { notificationManager } = await import('../services/notificationManager')
          // Don't reinitialize, just set the current user
          notificationManager.setCurrentUser(userData)
          console.log('✅ [AUTH] Notification manager configured for NEW account')
        } catch (notifError) {
          console.error('❌ [AUTH] Failed to configure notification manager for new account:', notifError)
          // Don't fail login if notifications fail
        }
      } else {
        console.log('📱 [AUTH] Initializing notifications for existing user:', userData.id)
        try {
          const { notificationManager } = await import('../services/notificationManager')
          await notificationManager.initialize(userData)
          console.log('✅ [AUTH] Notifications initialized for existing user via manager')

          // Refresh user data after notification initialization to get updated push token
          console.log('🔄 [AUTH] Refreshing user data after existing user notification initialization...')
          try {
              await new Promise(resolve => setTimeout(resolve, 1000))
            const refreshedUser = await RobustDeviceAuthService.refreshToken()
            setUser(refreshedUser)
            console.log('✅ [AUTH] User data refreshed after existing user notification initialization')
          } catch (refreshError) {
            console.warn('⚠️ [AUTH] Could not refresh user data after existing user notification init:', refreshError.message)
            // Don't fail if refresh fails in offline mode
          }
        } catch (notifError) {
          console.error('❌ [AUTH] Failed to initialize notifications via manager on login:', notifError)
          // Don't fail login if notifications fail
        }
      }
    }
  }

  const logout = async (clearAllData = false) => {
    try {
      console.log('🚪 [AUTH] Enhanced logout initiated, clearAllData:', clearAllData)
      
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
      
      // Use robust logout
      await RobustDeviceAuthService.logout(clearAllData)
      
      setUser(null)
      setError(null)
      setAuthState(null)
      
      console.log('✅ [AUTH] Enhanced logout completed')
    } catch (err) {
      console.error('❌ [AUTH] Enhanced logout error:', err)
      setError(err.message)
      
      // Even on error, clear the UI state
      setUser(null)
      setAuthState(null)
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
      
      // Use original service for account deletion (no changes needed here)
      const result = await DeviceAuthService.deleteAccountAndLogout()
      setUser(null)
      setError(null)
      setAuthState(null)
      setLoading(false)
      return result
    } catch (err) {
      console.error('❌ [AUTH] Delete account error:', err)
      setError(err.message)
      setLoading(false)
      throw err
    }
  }

  const refreshAuth = async () => {
    try {
      console.log('🔄 [AUTH] Enhanced auth refresh initiated')
      
      const refreshedUser = await RobustDeviceAuthService.refreshToken()
      const currentAuthState = RobustDeviceAuthService.getCurrentAuthState()
      
      setUser(refreshedUser)
      setAuthState(currentAuthState)
      setError(null)
      
      console.log('✅ [AUTH] Enhanced auth refresh successful for user:', refreshedUser?.pseudo)
      return refreshedUser
    } catch (err) {
      console.error('❌ [AUTH] Enhanced auth refresh error:', err)
      
      // Check if we're in offline mode with valid stored data
      const currentAuthState = RobustDeviceAuthService.getCurrentAuthState()
      
      if (currentAuthState?.isOffline && currentAuthState?.user) {
        console.log('🔴 [AUTH] Refresh failed but offline data available, keeping user logged in')
        setAuthState(currentAuthState)
        setUser(currentAuthState.user)
        // Don't set error or logout in offline mode
        return currentAuthState.user
      }
      
      // Only logout if we're online and refresh truly failed
      if (currentAuthState?.isOnline) {
        console.log('🚪 [AUTH] Online refresh failed, performing logout')
        setError(err.message)
        await logout(false) // Don't clear all data, preserve for recovery
      } else {
        // In offline mode, just set the error but keep user logged in
        console.log('🔴 [AUTH] Offline refresh failed, but keeping user authenticated')
        setError('Offline mode - some features may be limited')
      }
      
      throw err
    }
  }

  const value = {
    user,
    loading,
    error,
    authState,
    connectionState,
    login,
    logout,
    deleteAccount,
    refreshAuth,
    isAuthenticated: !!user,
    isOnline: authState?.isOnline || false,
    isOffline: authState?.isOffline || false,
    isAuthenticating: authState?.isAuthenticating || false,
    isRecovering: authState?.isRecovering || false,
    lastOnlineSync: authState?.lastOnlineSync || 0
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
  console.log('🟡 [TRACE] useAuthContext hook', { user: context?.user?.pseudo, authState: context?.authState?.state, isAuthenticated: context?.isAuthenticated });
  return context || { 
    user: null, 
    loading: true, 
    error: null, 
    authState: null,
    connectionState: 'unknown',
    isAuthenticated: false,
    isOnline: false,
    isOffline: false,
    isAuthenticating: false,
    isRecovering: false,
    lastOnlineSync: 0
  }
}

export default AuthContext
