/**
 * Central optimization manager
 * Coordinates all optimization systems and provides monitoring capabilities
 * Uses only unified services for production readiness
 */

import { unifiedMediaService } from '../services/unifiedMediaService'
import { batchManager } from './batchOperations'
import { realtimeManager } from './realtime'

class OptimizationManager {
  constructor() {
    this.isInitialized = false
    this.metrics = {
      totalRequests: 0,
      cachedRequests: 0,
      realtimeUpdates: 0,
      batchedOperations: 0,
      lastOptimization: null
    }
    this.performanceMonitor = null
    this.optimizationInterval = null
  }

  initialize() {
    if (this.isInitialized) return

    console.log('Initializing optimization manager...')

    // Start performance monitoring
    this.startPerformanceMonitoring()

    // Schedule regular optimizations
    this.scheduleOptimizations()

    // Setup app lifecycle handlers
    this.setupLifecycleHandlers()

    this.isInitialized = true
    console.log('Optimization manager initialized')
  }

  startPerformanceMonitoring() {
    this.performanceMonitor = setInterval(() => {
      this.collectMetrics()
    }, 30000) // Every 30 seconds
  }

  scheduleOptimizations() {
    // Run optimization every 5 minutes
    this.optimizationInterval = setInterval(() => {
      this.runOptimization()
    }, 5 * 60 * 1000)
  }

  setupLifecycleHandlers() {
    // React Native app state handling (mobile compatible)
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      // Web environment only
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.onAppBackground()
        } else {
          this.onAppForeground()
        }
      })
      
      // Handle app termination
      window.addEventListener('beforeunload', () => {
        this.onAppTermination()
      })
    } else {
      // Mobile environment - setup will be handled by React Native AppState
      console.log('Mobile optimization manager - lifecycle handled by React Native')
    }
  }

  async runOptimization() {
    try {
      console.log('Running optimization cycle...')
      
      // 1. Clean up unified media service cache
      unifiedMediaService.clearCache()
      
      // 2. Optimize storage if needed
      if (this.shouldOptimizeStorage()) {
        unifiedMediaService.clearCache()
      }
      
      // 3. Clean up unused real-time subscriptions
      this.cleanupUnusedSubscriptions()
      
      this.metrics.lastOptimization = new Date().toISOString()
      console.log('Optimization cycle completed')
      
    } catch (error) {
      console.error('Error during optimization cycle:', error)
    }
  }

  shouldOptimizeStorage() {
    const lastOptimization = this.metrics.lastOptimization
    if (!lastOptimization) return true
    
    const timeSinceLastOptimization = Date.now() - new Date(lastOptimization).getTime()
    return timeSinceLastOptimization > 15 * 60 * 1000 // 15 minutes
  }

  cleanupUnusedSubscriptions() {
    const channelInfo = realtimeManager.getChannelInfo()
    
    // If we have channels with no subscribers, clean them up
    if (channelInfo.activeChannels > channelInfo.totalSubscribers) {
      console.log('Cleaning up unused real-time subscriptions')
      // This would need to be implemented in the realtime manager
    }
  }

  collectMetrics() {
    try {
      // Get stats from unified services
      const mediaStats = unifiedMediaService.getCacheStats()
      const realtimeStats = realtimeManager.getChannelInfo()
      const batchStats = batchManager.getStats()

      // Update metrics using unified system
      this.metrics.cachedRequests = mediaStats.signedUrls || 0
      this.metrics.totalRequests = this.metrics.cachedRequests + mediaStats.files || 0
      this.metrics.realtimeUpdates = realtimeStats.totalSubscribers || 0
      this.metrics.batchedOperations = batchStats.totalPending || 0

      // Log performance summary
      const hitRate = this.metrics.totalRequests > 0 
        ? ((this.metrics.cachedRequests / this.metrics.totalRequests) * 100).toFixed(1)
        : 0

      console.log(`Performance Summary:
        - Cache Hit Rate: ${hitRate}%
        - Active Channels: ${realtimeStats.activeChannels}
        - Pending Batches: ${batchStats.totalPending}
        - Media URLs Cached: ${mediaStats.signedUrls}
        - Files Cached Locally: ${mediaStats.files}
      `)

    } catch (error) {
      console.error('Error collecting metrics:', error)
    }
  }

  async onAppBackground() {
    console.log('App backgrounded - flushing operations')
    
    try {
      // Flush all pending operations
      await batchManager.flushAll()
      
      // Run quick optimization
      cache.cleanup()
      mediaCacheManager.cleanup()
      
    } catch (error) {
      console.error('Error during app background optimization:', error)
    }
  }

  onAppForeground() {
    console.log('App foregrounded - resuming optimizations')
    
    // Restart monitoring if stopped
    if (!this.performanceMonitor) {
      this.startPerformanceMonitoring()
    }
  }

  async onAppTermination() {
    console.log('App terminating - final cleanup')
    
    try {
      // Flush all operations
      await batchManager.flushAll()
      
      // Clear intervals
      if (this.performanceMonitor) {
        clearInterval(this.performanceMonitor)
      }
      if (this.optimizationInterval) {
        clearInterval(this.optimizationInterval)
      }
      
      // Unsubscribe from all real-time channels
      realtimeManager.unsubscribeAll()
      
    } catch (error) {
      console.error('Error during app termination cleanup:', error)
    }
  }

  // Public API methods
  getMetrics() {
    return {
      ...this.metrics,
      cache: cache.getStats(),
      mediaCache: mediaCacheManager.getStats(),
      realtime: realtimeManager.getChannelInfo(),
      batches: batchManager.getStats()
    }
  }

  getOptimizationReport() {
    const metrics = this.getMetrics()
    
    return {
      summary: {
        cacheHitRate: metrics.totalRequests > 0 
          ? `${((metrics.cachedRequests / metrics.totalRequests) * 100).toFixed(1)}%`
          : '0%',
        activeConnections: metrics.realtime.activeChannels,
        pendingOperations: metrics.batches.totalPending,
        lastOptimization: metrics.lastOptimization
      },
      recommendations: this.generateRecommendations(metrics),
      detailed: metrics
    }
  }

  generateRecommendations(metrics) {
    const recommendations = []
    
    // Cache performance
    const hitRate = metrics.totalRequests > 0 
      ? (metrics.cachedRequests / metrics.totalRequests) * 100
      : 0
    
    if (hitRate < 70) {
      recommendations.push({
        type: 'cache',
        priority: 'high',
        message: `Cache hit rate is ${hitRate.toFixed(1)}%. Consider increasing cache TTL or preloading more data.`
      })
    }
    
    // Real-time connections
    if (metrics.realtime.activeChannels > 10) {
      recommendations.push({
        type: 'realtime',
        priority: 'medium',
        message: `${metrics.realtime.activeChannels} active real-time channels. Consider consolidating subscriptions.`
      })
    }
    
    // Pending operations
    if (metrics.batches.totalPending > 50) {
      recommendations.push({
        type: 'batching',
        priority: 'medium',
        message: `${metrics.batches.totalPending} pending batch operations. Consider reducing batch delay.`
      })
    }
    
    // Media cache
    if (metrics.mediaCache.expiredUrls > 20) {
      recommendations.push({
        type: 'media',
        priority: 'low',
        message: `${metrics.mediaCache.expiredUrls} expired media URLs. Running cleanup.`
      })
    }
    
    return recommendations
  }

  // Manual optimization trigger
  async optimize() {
    await this.runOptimization()
    return this.getOptimizationReport()
  }

  // Cache management
  clearAllCaches() {
    cache.clear()
    mediaCache.clear()
    userCache.clear()
    mediaCacheManager.clearCache()
    console.log('All caches cleared')
  }

  // Emergency cleanup (for memory issues)
  emergencyCleanup() {
    console.log('Running emergency cleanup...')
    
    this.clearAllCaches()
    realtimeManager.unsubscribeAll()
    batchManager.clear()
    unifiedMediaService.clearCache()
    
    console.log('Emergency cleanup completed')
  }

  shutdown() {
    console.log('Shutting down optimization manager...')
    
    if (this.performanceMonitor) {
      clearInterval(this.performanceMonitor)
      this.performanceMonitor = null
    }
    
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval)
      this.optimizationInterval = null
    }
    
    this.isInitialized = false
    console.log('Optimization manager shut down')
  }
}

// Create singleton instance
export const optimizationManager = new OptimizationManager()

// Auto-initialize when imported
optimizationManager.initialize()

export default optimizationManager
