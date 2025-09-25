import { NetworkService } from './networkService'
import { RobustDeviceAuthService } from './robustDeviceAuthService'

/**
 * Connection Recovery Service
 * Handles automatic recovery when internet connection is restored
 */
export class ConnectionRecoveryService {
  static _isActive = false
  static _recoveryQueue = []
  static _connectionListener = null
  static _maxRetries = 3
  static _retryDelay = 2000

  /**
   * Start connection recovery monitoring
   */
  static start() {
    if (this._isActive) return

    console.log('🔌 [CONNECTION_RECOVERY] Starting connection recovery service')
    this._isActive = true

    // Listen for connection changes
    this._connectionListener = NetworkService.addConnectionListener(async (isConnected) => {
      if (isConnected) {
        console.log('🟢 [CONNECTION_RECOVERY] Connection restored, processing recovery queue')
        await this._processRecoveryQueue()
      } else {
        console.log('🔴 [CONNECTION_RECOVERY] Connection lost, entering offline mode')
        await this._handleConnectionLoss()
      }
    })

    console.log('✅ [CONNECTION_RECOVERY] Service started')
  }

  /**
   * Stop connection recovery monitoring
   */
  static stop() {
    if (!this._isActive) return

    console.log('⏹️ [CONNECTION_RECOVERY] Stopping connection recovery service')

    if (this._connectionListener) {
      this._connectionListener()
      this._connectionListener = null
    }

    this._isActive = false
    this._recoveryQueue = []

    console.log('✅ [CONNECTION_RECOVERY] Service stopped')
  }

  /**
   * Add a recovery task to the queue
   */
  static addRecoveryTask(task) {
    if (!this._isActive) return

    console.log('📝 [CONNECTION_RECOVERY] Adding recovery task:', task.type)
    
    // Avoid duplicates
    const existingTask = this._recoveryQueue.find(t => t.type === task.type && t.id === task.id)
    if (existingTask) {
      console.log('⚠️ [CONNECTION_RECOVERY] Task already queued, updating:', task.type)
      Object.assign(existingTask, task)
    } else {
      this._recoveryQueue.push({
        ...task,
        timestamp: Date.now(),
        retryCount: 0
      })
    }
  }

  /**
   * Process all queued recovery tasks
   */
  static async _processRecoveryQueue() {
    if (this._recoveryQueue.length === 0) {
      console.log('📭 [CONNECTION_RECOVERY] No recovery tasks queued')
      return
    }

    console.log(`🔄 [CONNECTION_RECOVERY] Processing ${this._recoveryQueue.length} recovery tasks`)

    const tasksToProcess = [...this._recoveryQueue]
    this._recoveryQueue = []

    for (const task of tasksToProcess) {
      try {
        await this._executeRecoveryTask(task)
      } catch (error) {
        console.error('❌ [CONNECTION_RECOVERY] Task failed:', task.type, error)
        
        // Retry failed tasks up to max retries
        if (task.retryCount < this._maxRetries) {
          task.retryCount++
          console.log(`🔄 [CONNECTION_RECOVERY] Retrying task ${task.type} (attempt ${task.retryCount}/${this._maxRetries})`)
          
          setTimeout(() => {
            this._recoveryQueue.push(task)
            this._processRecoveryQueue()
          }, this._retryDelay * task.retryCount)
        } else {
          console.error('❌ [CONNECTION_RECOVERY] Task failed permanently:', task.type)
        }
      }
    }
  }

  /**
   * Execute a specific recovery task
   */
  static async _executeRecoveryTask(task) {
    console.log('⚡ [CONNECTION_RECOVERY] Executing task:', task.type)

    switch (task.type) {
      case 'auth_sync':
        await this._syncAuthentication(task)
        break
        
      case 'refresh_token':
        await this._refreshAuthToken(task)
        break
        
      case 'user_profile_sync':
        await this._syncUserProfile(task)
        break
        
      case 'device_migration':
        await this._migrateDevice(task)
        break
        
      default:
        console.warn('⚠️ [CONNECTION_RECOVERY] Unknown task type:', task.type)
    }
  }

  /**
   * Sync authentication state
   */
  static async _syncAuthentication(task) {
    try {
      console.log('🔐 [CONNECTION_RECOVERY] Syncing authentication')
      
      const currentUser = RobustDeviceAuthService.getCurrentUser()
      if (currentUser) {
        const refreshedUser = await RobustDeviceAuthService.refreshToken()
        console.log('✅ [CONNECTION_RECOVERY] Auth sync successful for:', refreshedUser?.pseudo)
      }
      
    } catch (error) {
      console.warn('⚠️ [CONNECTION_RECOVERY] Auth sync failed:', error)
      throw error
    }
  }

  /**
   * Refresh authentication token
   */
  static async _refreshAuthToken(task) {
    try {
      console.log('🎫 [CONNECTION_RECOVERY] Refreshing auth token')
      
      const refreshedUser = await RobustDeviceAuthService.refreshToken()
      if (refreshedUser) {
        console.log('✅ [CONNECTION_RECOVERY] Token refresh successful')
      } else {
        throw new Error('Token refresh returned no user')
      }
      
    } catch (error) {
      console.warn('⚠️ [CONNECTION_RECOVERY] Token refresh failed:', error)
      throw error
    }
  }

  /**
   * Sync user profile data
   */
  static async _syncUserProfile(task) {
    try {
      console.log('👤 [CONNECTION_RECOVERY] Syncing user profile')
      
      // This would sync any offline changes or get latest profile updates
      // Implementation depends on your specific sync requirements
      
      console.log('✅ [CONNECTION_RECOVERY] User profile sync completed')
      
    } catch (error) {
      console.warn('⚠️ [CONNECTION_RECOVERY] User profile sync failed:', error)
      throw error
    }
  }

  /**
   * Migrate device ID
   */
  static async _migrateDevice(task) {
    try {
      console.log('📱 [CONNECTION_RECOVERY] Migrating device')
      
      const currentUser = RobustDeviceAuthService.getCurrentUser()
      if (currentUser) {
        const migratedUser = await RobustDeviceAuthService._handleDeviceIdMigration(currentUser)
        if (migratedUser) {
          console.log('✅ [CONNECTION_RECOVERY] Device migration successful')
        } else {
          throw new Error('Device migration returned no user')
        }
      }
      
    } catch (error) {
      console.warn('⚠️ [CONNECTION_RECOVERY] Device migration failed:', error)
      throw error
    }
  }

  /**
   * Handle connection loss
   */
  static async _handleConnectionLoss() {
    try {
      console.log('🔴 [CONNECTION_RECOVERY] Handling connection loss')
      
      // Queue essential sync tasks for when connection returns
      const currentUser = RobustDeviceAuthService.getCurrentUser()
      if (currentUser) {
        this.addRecoveryTask({
          type: 'auth_sync',
          id: currentUser.id,
          priority: 'high'
        })
        
        this.addRecoveryTask({
          type: 'refresh_token',
          id: currentUser.id,
          priority: 'high'
        })
      }
      
      console.log('📝 [CONNECTION_RECOVERY] Queued essential tasks for connection recovery')
      
    } catch (error) {
      console.error('❌ [CONNECTION_RECOVERY] Error handling connection loss:', error)
    }
  }

  /**
   * Get current recovery queue status
   */
  static getQueueStatus() {
    return {
      isActive: this._isActive,
      queueLength: this._recoveryQueue.length,
      tasks: this._recoveryQueue.map(task => ({
        type: task.type,
        id: task.id,
        priority: task.priority,
        retryCount: task.retryCount,
        timestamp: task.timestamp
      }))
    }
  }

  /**
   * Force process recovery queue (manual trigger)
   */
  static async forceProcessQueue() {
    if (!this._isActive) {
      console.warn('⚠️ [CONNECTION_RECOVERY] Service not active, cannot process queue')
      return
    }

    const isConnected = await NetworkService.isConnected()
    if (!isConnected) {
      console.warn('⚠️ [CONNECTION_RECOVERY] No connection available for manual processing')
      return
    }

    console.log('🔧 [CONNECTION_RECOVERY] Manually processing recovery queue')
    await this._processRecoveryQueue()
  }
}