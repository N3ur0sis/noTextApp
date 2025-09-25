import { getUserData, saveAuthState, getAuthState, clearUserData, savePreviousUser, getPreviousUser } from '../utils/secureStore'
import { RobustDeviceAuthService } from './robustDeviceAuthService'
import { NetworkService } from './networkService'

/**
 * Authentication Health Monitor
 * Monitors auth state health and performs recovery when needed
 */
export class AuthHealthMonitor {
  static _isMonitoring = false
  static _checkInterval = null
  static _healthMetrics = {
    lastSuccessfulAuth: 0,
    failedAttempts: 0,
    lastRecoveryAttempt: 0,
    totalRecoveries: 0
  }

  /**
   * Start monitoring authentication health
   */
  static startMonitoring(intervalMs = 60000) { // Check every minute
    if (this._isMonitoring) return

    console.log('❤️ [AUTH_HEALTH] Starting authentication health monitoring...')
    this._isMonitoring = true

    // Load existing metrics
    this._loadHealthMetrics()

    // Perform initial health check
    this._performHealthCheck()

    // Set up periodic checks
    this._checkInterval = setInterval(() => {
      this._performHealthCheck()
    }, intervalMs)

    console.log('✅ [AUTH_HEALTH] Health monitoring started')
  }

  /**
   * Stop monitoring
   */
  static stopMonitoring() {
    if (!this._isMonitoring) return

    console.log('⏹️ [AUTH_HEALTH] Stopping authentication health monitoring...')
    
    if (this._checkInterval) {
      clearInterval(this._checkInterval)
      this._checkInterval = null
    }

    this._isMonitoring = false
    this._saveHealthMetrics()
    
    console.log('✅ [AUTH_HEALTH] Health monitoring stopped')
  }

  /**
   * Perform a health check on the authentication system
   */
  static async _performHealthCheck() {
    try {
      console.log('🏥 [AUTH_HEALTH] Performing health check...')
      
      const currentUser = RobustDeviceAuthService.getCurrentUser()
      const authState = RobustDeviceAuthService.getCurrentAuthState()
      const storedUser = await getUserData()
      const isConnected = await NetworkService.isConnected()

      // Check 1: User consistency
      if (currentUser && storedUser && currentUser.id !== storedUser.id) {
        console.warn('⚠️ [AUTH_HEALTH] User ID mismatch detected')
        await this._handleUserMismatch(currentUser, storedUser)
        return
      }

      // Check 2: Auth state consistency  
      if (currentUser && !authState?.isAuthenticated) {
        console.warn('⚠️ [AUTH_HEALTH] Auth state inconsistency detected')
        await this._handleAuthStateInconsistency(currentUser)
        return
      }

      // Check 3: Stale offline authentication
      if (authState?.isOffline && authState.lastOnlineSync) {
        const daysSinceSync = (Date.now() - authState.lastOnlineSync) / (1000 * 60 * 60 * 24)
        
        if (daysSinceSync > 7 && isConnected) {
          console.log('🔄 [AUTH_HEALTH] Stale offline auth detected, attempting sync...')
          await this._attemptAuthSync()
          return
        }
        
        if (daysSinceSync > 30) {
          console.warn('⚠️ [AUTH_HEALTH] Very stale offline auth - may need re-authentication')
          await this._handleStaleAuth()
          return
        }
      }

      // Check 4: Ghost sessions (user but no stored data)
      if (currentUser && !storedUser) {
        console.warn('⚠️ [AUTH_HEALTH] Ghost session detected - user exists but no stored data')
        await this._handleGhostSession(currentUser)
        return
      }

      // Check 5: Orphaned data (stored data but no user)
      if (!currentUser && storedUser && isConnected) {
        console.log('🔄 [AUTH_HEALTH] Orphaned data detected, attempting recovery...')
        await this._attemptDataRecovery(storedUser)
        return
      }

      // All checks passed
      this._updateHealthMetrics({ lastSuccessfulAuth: Date.now(), failedAttempts: 0 })
      console.log('✅ [AUTH_HEALTH] All health checks passed')
      
    } catch (error) {
      console.error('❌ [AUTH_HEALTH] Health check failed:', error)
      this._updateHealthMetrics({ failedAttempts: this._healthMetrics.failedAttempts + 1 })
    }
  }

  /**
   * Handle user ID mismatch between current and stored user
   */
  static async _handleUserMismatch(currentUser, storedUser) {
    try {
      console.log('🔧 [AUTH_HEALTH] Resolving user mismatch...')
      
      // Save the previous user data before resolving
      await savePreviousUser(storedUser)
      
      // Update stored data to match current user
      await getUserData(currentUser)
      
      console.log('✅ [AUTH_HEALTH] User mismatch resolved')
      
    } catch (error) {
      console.error('❌ [AUTH_HEALTH] Failed to resolve user mismatch:', error)
    }
  }

  /**
   * Handle authentication state inconsistency
   */
  static async _handleAuthStateInconsistency(currentUser) {
    try {
      console.log('🔧 [AUTH_HEALTH] Resolving auth state inconsistency...')
      
      // Force auth state update
      const newAuthState = {
        state: RobustDeviceAuthService.AUTH_STATES.OFFLINE_AUTHENTICATED,
        user: currentUser,
        lastOnlineSync: Date.now(),
        isAuthenticated: true
      }
      
      await saveAuthState(newAuthState)
      
      console.log('✅ [AUTH_HEALTH] Auth state inconsistency resolved')
      
    } catch (error) {
      console.error('❌ [AUTH_HEALTH] Failed to resolve auth state inconsistency:', error)
    }
  }

  /**
   * Attempt to sync authentication when connection is available
   */
  static async _attemptAuthSync() {
    try {
      console.log('🔄 [AUTH_HEALTH] Attempting auth sync...')
      
      const refreshedUser = await RobustDeviceAuthService.refreshToken()
      if (refreshedUser) {
        console.log('✅ [AUTH_HEALTH] Auth sync successful')
        this._updateHealthMetrics({ lastSuccessfulAuth: Date.now() })
      }
      
    } catch (error) {
      console.warn('⚠️ [AUTH_HEALTH] Auth sync failed, but not critical:', error)
    }
  }

  /**
   * Handle very stale authentication
   */
  static async _handleStaleAuth() {
    try {
      console.log('🔧 [AUTH_HEALTH] Handling stale authentication...')
      
      const isConnected = await NetworkService.isConnected()
      if (isConnected) {
        // Try to refresh/recover
        const recoveryResult = await RobustDeviceAuthService.attemptAutoRecovery()
        if (recoveryResult) {
          console.log('✅ [AUTH_HEALTH] Stale auth recovered')
          return
        }
      }
      
      // If recovery fails, keep user logged in but mark as needs attention
      const currentAuthState = await getAuthState()
      if (currentAuthState) {
        currentAuthState.needsAttention = true
        currentAuthState.staleReason = 'very_old_offline_session'
        await saveAuthState(currentAuthState)
      }
      
      console.log('⚠️ [AUTH_HEALTH] Stale auth handled - user kept logged in with attention flag')
      
    } catch (error) {
      console.error('❌ [AUTH_HEALTH] Failed to handle stale auth:', error)
    }
  }

  /**
   * Handle ghost sessions
   */
  static async _handleGhostSession(currentUser) {
    try {
      console.log('🔧 [AUTH_HEALTH] Resolving ghost session...')
      
      // Save current user data to storage
      await getUserData(currentUser)
      await savePreviousUser(currentUser)
      
      // Update auth state
      const authState = {
        state: RobustDeviceAuthService.AUTH_STATES.ONLINE_AUTHENTICATED,
        user: currentUser,
        lastOnlineSync: Date.now(),
        isAuthenticated: true
      }
      
      await saveAuthState(authState)
      
      console.log('✅ [AUTH_HEALTH] Ghost session resolved')
      
    } catch (error) {
      console.error('❌ [AUTH_HEALTH] Failed to resolve ghost session:', error)
    }
  }

  /**
   * Attempt to recover from orphaned data
   */
  static async _attemptDataRecovery(storedUser) {
    try {
      console.log('🔄 [AUTH_HEALTH] Attempting data recovery...')
      
      const recoveryResult = await RobustDeviceAuthService.attemptAutoRecovery()
      if (recoveryResult) {
        console.log('✅ [AUTH_HEALTH] Data recovery successful')
        this._updateHealthMetrics({ totalRecoveries: this._healthMetrics.totalRecoveries + 1 })
      } else {
        console.log('⚠️ [AUTH_HEALTH] Data recovery failed - keeping data for manual recovery')
      }
      
    } catch (error) {
      console.error('❌ [AUTH_HEALTH] Data recovery failed:', error)
    }
  }

  /**
   * Load health metrics from storage
   */
  static async _loadHealthMetrics() {
    try {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default
      const metricsStr = await AsyncStorage.getItem('@NoText:authHealthMetrics')
      
      if (metricsStr) {
        this._healthMetrics = { ...this._healthMetrics, ...JSON.parse(metricsStr) }
      }
    } catch (error) {
      console.warn('⚠️ [AUTH_HEALTH] Could not load health metrics:', error)
    }
  }

  /**
   * Save health metrics to storage
   */
  static async _saveHealthMetrics() {
    try {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default
      await AsyncStorage.setItem('@NoText:authHealthMetrics', JSON.stringify(this._healthMetrics))
    } catch (error) {
      console.warn('⚠️ [AUTH_HEALTH] Could not save health metrics:', error)
    }
  }

  /**
   * Update health metrics
   */
  static _updateHealthMetrics(updates) {
    this._healthMetrics = { ...this._healthMetrics, ...updates }
    this._saveHealthMetrics()
  }

  /**
   * Get current health metrics
   */
  static getHealthMetrics() {
    return { ...this._healthMetrics }
  }

  /**
   * Perform emergency recovery
   */
  static async performEmergencyRecovery() {
    try {
      console.log('🚨 [AUTH_HEALTH] Performing emergency recovery...')
      
      this._updateHealthMetrics({ 
        lastRecoveryAttempt: Date.now(),
        totalRecoveries: this._healthMetrics.totalRecoveries + 1
      })
      
      const recoveryResult = await RobustDeviceAuthService.attemptAutoRecovery()
      if (recoveryResult) {
        console.log('✅ [AUTH_HEALTH] Emergency recovery successful')
        return recoveryResult
      }
      
      // Last resort: check previous user
      const previousUser = await getPreviousUser()
      if (previousUser) {
        console.log('🛡️ [AUTH_HEALTH] Using previous user data as emergency fallback')
        await getUserData(previousUser)
        
        const emergencyAuthState = {
          state: RobustDeviceAuthService.AUTH_STATES.OFFLINE_AUTHENTICATED,
          user: previousUser,
          lastOnlineSync: 0,
          isEmergencyRecovery: true
        }
        
        await saveAuthState(emergencyAuthState)
        
        return { user: previousUser, authState: emergencyAuthState }
      }
      
      console.log('❌ [AUTH_HEALTH] Emergency recovery failed - no fallback data available')
      return null
      
    } catch (error) {
      console.error('❌ [AUTH_HEALTH] Emergency recovery error:', error)
      return null
    }
  }
}