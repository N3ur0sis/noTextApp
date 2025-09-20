/**
 * Optimized Real-time Cache Manager - Production Ready
 * Unified realtime event handling with optimized cache coordination
 * Memory-efficient implementation with performance monitoring
 */

import { AppState } from 'react-native'
import { apiManager } from './apiManager'
import CacheService from './cacheService'
import { productionRealtimeService } from './productionRealtimeService'
import { realtimeService } from './realtimeService'
import { getCurrentUser } from './userService'

// Optimized event emitter with memory leak prevention
class EnhancedEventEmitter {
  constructor() {
    this.events = new Map();
    this.listenerCounts = new Map();
    this.stats = {
      totalEventsEmitted: 0,
      eventCounts: {},
      lastEmission: null,
      activeListeners: 0
    };
    this._logWarningsEnabled = __DEV__;
  }

  on(event, listener) {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    
    // Prevent duplicate listeners
    this.events.get(event).add(listener);
    
    // Track listener counts for leak detection
    this.listenerCounts.set(listener, (this.listenerCounts.get(listener) || 0) + 1);
    this.stats.activeListeners++;
    
    // Warn about potential memory leaks
    if (this._logWarningsEnabled && this.listenerCounts.get(listener) > 3) {
      console.warn(`⚠️ [EventEmitter] Possible memory leak detected: Listener added ${this.listenerCounts.get(listener)} times without cleanup`);
    }
    
    return () => this.off(event, listener); // Return unsubscribe function
  }

  off(event, listener) {
    if (!this.events.has(event)) return;
    
    const eventSet = this.events.get(event);
    if (eventSet.has(listener)) {
      eventSet.delete(listener);
      
      // Update counts
      const currentCount = this.listenerCounts.get(listener) || 0;
      if (currentCount > 1) {
        this.listenerCounts.set(listener, currentCount - 1);
      } else {
        this.listenerCounts.delete(listener);
      }
      
      this.stats.activeListeners = Math.max(0, this.stats.activeListeners - 1);
      
      // Clean up empty event sets
      if (eventSet.size === 0) {
        this.events.delete(event);
      }
    }
  }

  emit(event, ...args) {
    if (!this.events.has(event)) return 0;
    
    const eventSet = this.events.get(event);
    let emitCount = 0;
    
    // Track statistics
    this.stats.totalEventsEmitted++;
    this.stats.eventCounts[event] = (this.stats.eventCounts[event] || 0) + 1;
    this.stats.lastEmission = new Date();
    
    // Use microtasks for critical events to ensure they're processed immediately
    const isCriticalEvent = event === 'messageReceived' || event === 'messageSent';
    
    if (isCriticalEvent) {
      // For critical events, use Promise.resolve() for immediate microtask execution
      // This ensures the UI updates as quickly as possible
      if (__DEV__) console.log(`⚡ [EventEmitter] Critical event "${event}" - immediate execution`);
      
      Promise.resolve().then(() => {
        eventSet.forEach(listener => {
          try {
            listener(...args);
            emitCount++;
          } catch (error) {
            console.error(`❌ [EventEmitter] Error in critical listener for event "${event}":`, error);
          }
        });
      });
    } else {
      // Standard execution for non-critical events
      eventSet.forEach(listener => {
        try {
          listener(...args);
          emitCount++;
        } catch (error) {
          console.error(`❌ [EventEmitter] Error in listener for event "${event}":`, error);
        }
      });
    }
    
    return emitCount;
  }

  removeAllListeners(event) {
    if (event) {
      // Remove specific event
      if (this.events.has(event)) {
        const count = this.events.get(event).size;
        this.events.delete(event);
        this.stats.activeListeners = Math.max(0, this.stats.activeListeners - count);
        if (__DEV__) console.log(`🧹 [EventEmitter] Removed ${count} listeners for event: ${event}`);
      }
    } else {
      // Remove all events
      if (__DEV__) {
        console.log(`🧹 [EventEmitter] Removing all listeners (${this.stats.activeListeners} total)`);
      }
      this.events.clear();
      this.listenerCounts.clear();
      this.stats.activeListeners = 0;
    }
  }
  
  getStats() {
    return {
      ...this.stats,
      events: Array.from(this.events.keys()).map(event => ({
        name: event,
        listeners: this.events.get(event).size
      }))
    };
  }
}

class OptimizedRealtimeCacheManager extends EnhancedEventEmitter {
  constructor() {
    super();
    this.currentUserId = null;
    this.isInitialized = false;
    this.initializationPromise = null;
    
    // CRITICAL FIX: Initialize subscriptions Map
    this.subscriptions = new Map();
    
    // OPTIMIZATION: Add pending operations tracking to prevent duplicate API calls
    this.pendingOperations = new Set();
    
    // COLD START FIX: Store pending notification events for when HomeScreen mounts
    this.pendingNotificationEvents = [];
    this.homeScreenReady = false;
    
    // Enhanced state tracking
    this._appState = AppState.currentState;
    this._isActive = true;
    this._lastEventTimestamp = Date.now();
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 5;
    this._reconnectTimeout = null;
    
    // Performance metrics
    this.metrics = {
      eventCount: 0,
      lastConnected: null,
      realtimeLatency: null,
      messageProcessingTimes: []
    };
    
    // Initialize app state tracking
    this._setupAppStateListener();
  }

  // Unified cache key management - optimized to minimize key count
  getCacheKeys(userId) {
    const base = `user:${userId}`;
    return {
      conversations: `${base}:conversations`,
      messages: `${base}:messages`,
      presence: `${base}:presence`,
      lastSeen: `${base}:lastSeen`
    };
  }

  /**
   * Track app state for optimal connection management
   * Reconnect when app comes to foreground
   */
  _setupAppStateListener() {
    AppState.addEventListener('change', nextAppState => {
      const wasActive = this._isActive;
      this._isActive = nextAppState === 'active';
      this._appState = nextAppState;
      
      // App came to foreground
      if (!wasActive && this._isActive && this.currentUserId) {
        if (__DEV__) console.log('🔄 [RealTime] App active, reconnecting...');
        this.initialize(this.currentUserId);
      }
    });
  }

  /**
   * COLD START FIX: Override emit method to handle notification events specially
   * Store notification events if HomeScreen isn't ready yet
   */
  emit(event, ...args) {
    // Handle cold start notification events
    if ((event === 'appOpenedFromNotification' || event === 'appReturnedFromBackground') && !this.homeScreenReady) {
      console.log(`📱 [COLD_START] Storing pending notification event: ${event}`);
      this.pendingNotificationEvents.push({ event, args: [...args], timestamp: Date.now() });
      return 0;
    }
    
    // Call parent emit for all other events
    return super.emit(event, ...args);
  }

  /**
   * COLD START FIX: Mark HomeScreen as ready and process pending notification events
   * This should be called when HomeScreen mounts and sets up its listeners
   */
  setHomeScreenReady() {
    console.log(`📱 [COLD_START] HomeScreen is ready, processing ${this.pendingNotificationEvents.length} pending events`);
    this.homeScreenReady = true;
    
    // Process any pending notification events
    const pendingEvents = [...this.pendingNotificationEvents];
    this.pendingNotificationEvents = [];
    
    // Add a small delay to ensure listeners are fully set up
    setTimeout(() => {
      pendingEvents.forEach(({ event, args }) => {
        console.log(`📱 [COLD_START] Processing pending ${event} event`);
        super.emit(event, ...args);
      });
    }, 100);
  }

  /**
   * COLD START FIX: Reset HomeScreen ready state (called when HomeScreen unmounts)
   */
  setHomeScreenNotReady() {
    console.log(`📱 [COLD_START] HomeScreen no longer ready`);
    this.homeScreenReady = false;
  }

  /**
   * Handle realtime events from productionRealtimeService
   * Optimized event processing with batching and deduplication
   */
  _handleRealtimeEvent(payload) {
    const startTime = Date.now();
    
    try {
      this.metrics.eventCount++;
      this._lastEventTimestamp = startTime;
      
      const { eventType, new: newData, old: oldData } = payload;
      
      if (__DEV__) {
        console.log(`📥 [RealTime] Event: ${eventType}`, {
          messageId: newData?.id,
          sender: newData?.sender_id,
          receiver: newData?.receiver_id
        });
      }
      
      // Process different event types with optimized handlers
      switch (eventType) {
        case 'INSERT':
          this._handleMessageInsert(newData);
          break;
        case 'UPDATE':
          this._handleMessageUpdate(newData, oldData);
          break;
        case 'DELETE':
          this._handleMessageDelete(oldData);
          break;
        default:
          if (__DEV__) console.warn(`🤷‍♂️ [RealTime] Unknown event type: ${eventType}`);
      }
      
      // Track processing time for performance monitoring
      const processingTime = Date.now() - startTime;
      this.metrics.messageProcessingTimes.push(processingTime);
      
      // Keep only last 100 processing times for memory efficiency
      if (this.metrics.messageProcessingTimes.length > 100) {
        this.metrics.messageProcessingTimes = this.metrics.messageProcessingTimes.slice(-50);
      }
      
      // Calculate realtime latency if timestamp available
      if (newData?.created_at) {
        const messageTime = new Date(newData.created_at).getTime();
        this.metrics.realtimeLatency = startTime - messageTime;
      }
      
    } catch (error) {
      console.error('❌ [RealTime] Event processing error:', error);
    }
  }
  
  /**
   * Handle new message insertion with optimized cache updates
   * Prioritizes immediate UI updates for better real-time experience
   */
  _handleMessageInsert(messageData) {
    if (!messageData || !this.currentUserId) return;
    
    const isRelevantToUser = 
      messageData.sender_id === this.currentUserId || 
      messageData.receiver_id === this.currentUserId;
      
    if (!isRelevantToUser) return;
    
    const otherUserId = messageData.sender_id === this.currentUserId 
      ? messageData.receiver_id 
      : messageData.sender_id;
    
    // IMPROVED ORDER: First emit events for immediate UI updates before cache operations
    // This ensures UI gets notified first for better responsiveness
    
    if (__DEV__) {
      console.log(`🚀 [REALTIME] Emitting realtime events for message ${messageData.id} before cache updates`);
    }
    
    // Emit events for UI updates FIRST for better real-time experience
    this.emit('messageReceived', {
      message: messageData,
      otherUserId,
      conversationId: otherUserId, // Added to help with message targeting
      sender_id: messageData.sender_id,
      receiver_id: messageData.receiver_id,
      timestamp: Date.now()
    });
    
    this.emit('conversationUpdate', {
      type: 'new_message',
      messageId: messageData.id,
      message: messageData, // Include full message data
      otherUserId,
      conversationId: otherUserId, // Added to help with message targeting
      timestamp: Date.now()
    });
    
    // Second priority: update message cache for immediate message display
    this.updateCache('messages', this.currentUserId, null, {
      priority: 'high',
      source: 'realtime',
      conversationId: otherUserId,
      messageData
    });
    
    // Third priority: update conversations cache for home screen
    this.updateCache('conversations', this.currentUserId, null, {
      priority: 'high',
      source: 'realtime', 
      forceUpdate: true,
      messageData
    });
  }
  
  /**
   * Handle message updates (read status, etc.)
   */
  _handleMessageUpdate(newData, oldData) {
    if (!newData || !this.currentUserId) return;
    
    const isRelevantToUser = 
      newData.sender_id === this.currentUserId || 
      newData.receiver_id === this.currentUserId;
      
    if (!isRelevantToUser) return;
    
    // Check what changed for optimized updates
    const changedFields = this._getChangedFields(oldData, newData);
    
    // Handle read status updates (use schema-consistent field names)
    if (changedFields.includes('seen') || changedFields.includes('seen_at')) {
      const seenAtTs = newData.seen_at || new Date().toISOString();
      const otherUserId = (newData.sender_id === this.currentUserId) ? newData.receiver_id : newData.sender_id;

      // 1) Emit standardized event for hooks
      this.emit('messageReadStatusUpdated', {
        messageId: newData.id,
        senderId: newData.sender_id,
        receiverId: newData.receiver_id,
        readerId: newData.receiver_id, // The receiver is the one who read it
        readAt: seenAtTs,
        read: !!newData.seen,
        timestamp: Date.now()
      });

      // 2) Update message caches in-place so Chat UI flips instantly
      try {
        this.updateMessageInCache(newData, otherUserId);
      } catch (e) {
        if (__DEV__) console.warn('⚠️ [REALTIME] Failed to update message cache on read:', e);
      }

      // 3) Update conversation caches for both participants for Home indicators
      try {
        this.updateConversationCacheWithReadStatus(newData.id, newData.sender_id, newData.receiver_id, seenAtTs);
      } catch (e) {
        if (__DEV__) console.warn('⚠️ [REALTIME] Failed to update conversation cache on read:', e);
      }

      // 4) Emit compatibility events used by some hooks/handlers
      try {
        this.emit('conversationUpdate', {
          type: 'message_read',
          messageId: newData.id,
          senderId: newData.sender_id,
          receiverId: newData.receiver_id,
          timestamp: seenAtTs
        });
        this.emit('messageRead', {
          messageId: newData.id,
          senderId: newData.sender_id,
          receiverId: newData.receiver_id,
          seenAt: seenAtTs,
          by: newData.receiver_id
        });
      } catch (e) {}
    }
    
    this.emit('conversationUpdate', {
      type: 'message_updated',
      messageId: newData.id,
      changedFields,
      timestamp: Date.now()
    });
  }
  
  /**
   * Handle message deletion
   */
  _handleMessageDelete(deletedData) {
    if (!deletedData || !this.currentUserId) return;
    
    this.emit('messageDeleted', {
      messageId: deletedData.id,
      timestamp: Date.now()
    });
    
    this.emit('conversationUpdate', {
      type: 'message_deleted',
      messageId: deletedData.id,
      timestamp: Date.now()
    });
  }
  
  /**
   * Compare old and new data to determine what changed
   */
  _getChangedFields(oldData, newData) {
    const changes = [];
    
    if (!oldData || !newData) return changes;
    
  // Include read_at/read_by to capture read events stored as timestamps/ids
  const fieldsToCheck = ['seen', 'read', 'read_at', 'read_by', 'content', 'media_url', 'deleted_at'];
    
    fieldsToCheck.forEach(field => {
      if (oldData[field] !== newData[field]) {
        changes.push(field);
      }
    });
    
    return changes;
  }
  
  /**
   * Legacy method compatibility - get all conversation caches
   */
  getAllConversationCaches(userId) {
    const cacheKeys = this.getCacheKeys(userId);
    
    // Use the existing CacheService pattern
    try {
      // Try the new cache key format first
      const cached = CacheService.get('conversations', cacheKeys.conversations);
      if (cached) return Array.isArray(cached) ? cached : [];
      
      // Fallback to legacy format
      const legacyCached = CacheService.get('conversation', `conversations_${userId}`);
      return Array.isArray(legacyCached) ? legacyCached : [];
    } catch (error) {
      console.error('❌ [Cache] Error getting conversations:', error);
      return [];
    }
  }
  
  /**
   * Legacy method compatibility - update all conversation caches
   */
  updateAllConversationCaches(userId, conversations, isRealtimeUpdate = false) {
    try {
      // Use the legacy cache key format for backward compatibility
      CacheService.setWithPersist('conversation', `conversations_${userId}`, conversations);
      
      if (__DEV__) {
        console.log(`📊 [Cache] Updated conversations cache: ${conversations.length} conversations`);
      }
      
      return {
        unified: `conversations_${userId}`,
        realtimeMarker: `conversations_${userId}_fresh`
      };
    } catch (error) {
      console.error('❌ [Cache] Error updating conversations:', error);
      return null;
    }
  }
  
  /**
   * Legacy method compatibility - clear all conversation caches
   */
  clearAllConversationCaches(userId) {
    try {
      const legacyKey = `conversations_${userId}`;
      const markerKey = `${legacyKey}_fresh`;
      
      CacheService.delete('conversation', legacyKey);
      CacheService.delete('marker', markerKey);
      
      if (__DEV__) {
        console.log(`🗑️ [Cache] Cleared conversations cache: ${legacyKey}`);
      }
      
      return {
        unified: legacyKey,
        realtimeMarker: markerKey
      };
    } catch (error) {
      console.error('❌ [Cache] Error clearing conversations:', error);
      return null;
    }
  }
  
  /**
   * Check if cache is fresh from realtime updates
   */
  isCacheRealtimeFresh(userId, maxAgeSeconds = 1800) {
    try {
      const markerKey = `conversations_${userId}_fresh`;
      const marker = CacheService.get('marker', markerKey);
      
      if (!marker?.timestamp) return false;
      
      const ageInSeconds = (Date.now() - marker.timestamp) / 1000;
      return ageInSeconds <= maxAgeSeconds;
    } catch (error) {
      console.error('❌ [Cache] Error checking cache freshness:', error);
      return false;
    }
  }
  
  /**
   * Subscribe to all conversations - legacy method
   */
  async subscribeToAllConversations(userId) {
    // This is now handled automatically by productionRealtimeService
    if (__DEV__) {
      console.log('📡 [RealTime] Subscription managed by productionRealtimeService');
    }
    return true;
  }
  
  /**
   * Subscribe to specific conversation - legacy method
   */
  async subscribeToConversation(currentUserId, otherUserId) {
    // This is now handled automatically by productionRealtimeService
    if (__DEV__) {
      console.log('📡 [RealTime] Conversation subscription managed by productionRealtimeService');
    }
    return true;
  }
  
  /**
   * Unsubscribe from conversation - legacy method
   */
  unsubscribeFromConversation(currentUserId, otherUserId) {
    // This is now handled automatically by productionRealtimeService
    if (__DEV__) {
      console.log('📡 [RealTime] Conversation unsubscription managed by productionRealtimeService');
    }
  }
  
  /**
   * Enhanced cleanup with memory optimization
   */
  cleanup() {
    if (__DEV__) console.log('🧹 [RealTime] Cleaning up optimized cache manager');
    
    // Clear timeouts
    if (this._batchUpdateTimeout) {
      clearTimeout(this._batchUpdateTimeout);
      this._batchUpdateTimeout = null;
    }
    
    if (this._reconnectTimeout) {
      clearTimeout(this._reconnectTimeout);
      this._reconnectTimeout = null;
    }
    
    // Clear pending operations
    this._pendingUpdates.clear();
    this._lastUpdateTimes.clear();
    
    // Remove from productionRealtimeService
    try {
      productionRealtimeService.unregisterCallback('realtimeCacheManager');
    } catch (error) {
      if (__DEV__) console.warn('⚠️ [RealTime] Error unregistering callback:', error);
    }
    
    // Clean up event listeners
    this.removeAllListeners();
    
    // Reset state
    this.isInitialized = false;
    this.currentUserId = null;
    this.initializationPromise = null;
    this._reconnectAttempts = 0;
    
    if (__DEV__) console.log('✅ [RealTime] Cleanup completed');
  }

  // Simplified, optimized update with deduplication
  // Tracks last update time to avoid excessive writes
  _lastUpdateTimes = new Map();
  _pendingUpdates = new Map();
  _persistenceTimeout = null;
  
  // UNIFIED CACHE UPDATE - ALL parts of the app use this SAME cache
  updateAllConversationCaches(userId, conversations, isRealtimeUpdate = false) {
    const { unified, realtimeMarker } = this.getCacheKeys(userId);
    const now = Date.now();
    
    // Deduplicate rapid updates for the same user (within 1 second)
    const lastUpdate = this._lastUpdateTimes.get(userId) || 0;
    if (now - lastUpdate < 1000 && !isRealtimeUpdate) {
      // For non-realtime updates, just queue them and return
      if (!this._pendingUpdates.has(userId)) {
        this._pendingUpdates.set(userId, {
          conversations,
          isRealtimeUpdate,
          timestamp: now
        });
        
        // Schedule a deferred update
        setTimeout(() => this._processPendingUpdate(userId), 1000);
      }
      
      return { unified, realtimeMarker };
    }
    
    // Mark this update time
    this._lastUpdateTimes.set(userId, now);
    
    // SINGLE SOURCE OF TRUTH: Update ONLY the unified cache with PERSISTENCE
    CacheService.setWithPersist('conversation', unified, conversations);
    console.log(`📊 [UNIFIED CACHE] Updated conversations cache: ${conversations.length} conversations`);
    
    // Mark as fresh if it's a real-time update (also persisted)
    if (isRealtimeUpdate) {
      CacheService.setWithPersist('conversation', realtimeMarker, now);
      
      // Debounce persistence for better performance
      if (this._persistenceTimeout) {
        clearTimeout(this._persistenceTimeout);
      }
      
      this._persistenceTimeout = setTimeout(() => {
        CacheService.persistCache();
        this._persistenceTimeout = null;
      }, 200);
    }
    
    return { unified, realtimeMarker };
  }
  
  // Process a pending update that was deferred
  _processPendingUpdate(userId) {
    if (this._pendingUpdates.has(userId)) {
      const { conversations, isRealtimeUpdate } = this._pendingUpdates.get(userId);
      this._pendingUpdates.delete(userId);
      
      // Actually update the cache now
      this.updateAllConversationCaches(userId, conversations, isRealtimeUpdate);
    }
  }

  // Check if cache contains real-time fresh data (updated by real-time events)
  isCacheRealtimeFresh(userId, maxAgeSeconds = 1800) { // Default 30 minutes - very generous
    const { realtimeMarker } = this.getCacheKeys(userId)
    const realtimeTimestamp = CacheService.get('conversation', realtimeMarker)
    
    if (!realtimeTimestamp) return false
    
    const ageSeconds = (Date.now() - realtimeTimestamp) / 1000
    const isFresh = ageSeconds < maxAgeSeconds
    
    console.log('� [UNIFIED CACHE] Real-time freshness check:', {
      realtimeMarker,
      ageSeconds: Math.round(ageSeconds),
      maxAgeSeconds,
      isFresh
    })
    
    return isFresh
  }

  // UNIFIED CACHE RETRIEVAL - get from ONE unified cache only
  getAllConversationCaches(userId) {
    const { unified } = this.getCacheKeys(userId)
    
    // Get from unified cache only - no fallbacks
    let conversations = CacheService.get('conversation', unified)
    if (conversations && Array.isArray(conversations) && conversations.length > 0) {
      console.log('� [UNIFIED CACHE] Retrieved conversations:', unified, conversations.length, 'conversations')
      return conversations
    }
    
    if (__DEV__) console.log('� [UNIFIED CACHE] No conversations found in cache:', unified)
    return []
  }

  // UNIFIED CACHE CLEARING - clear the ONE unified cache
  clearAllConversationCaches(userId) {
    const { unified, realtimeMarker } = this.getCacheKeys(userId)
    
    // Clear unified cache
    CacheService.delete('conversation', unified)
    console.log('🗑️ [UNIFIED CACHE] Cleared conversations cache:', unified)
    
    // Clear real-time freshness marker
    CacheService.delete('conversation', realtimeMarker)
    console.log('🗑️ [UNIFIED CACHE] Cleared real-time marker:', realtimeMarker)
    
    return { unified, realtimeMarker }
  }

  // Initialize real-time cache management for a user
  async initialize(userId) {
    if (this.isInitialized && this.currentUserId === userId) {
      console.log('🔄 Real-time cache manager already initialized for user', userId)
      return
    }

    console.log('🚀 Initializing real-time cache manager for user', userId)
    
    // Clean up existing subscriptions if switching users
    if (this.currentUserId && this.currentUserId !== userId) {
      this.cleanup()
    }

    this.currentUserId = userId
    
    // Subscribe to all conversations for home screen updates
    this.subscribeToAllConversations(userId)
    
    // Register a handler for messageRead events
    console.log('🔄 [REALTIME] Adding handler for messageRead events')
    this.on('messageRead', (data) => {
      console.log('📨 [REALTIME] messageRead event received:', data)
      this.handleMessageReadEvent(data)
    })
    
    this.isInitialized = true
    console.log('✅ Real-time cache manager initialized')
  }

  // Subscribe to all conversations for home screen real-time updates
  async subscribeToAllConversations(userId) {
    console.log('🔥 [REALTIME DEBUG] Setting up subscription for user:', userId)
    
    // Don't re-initialize if already subscribed
    if (this.subscriptions.has('all_conversations')) {
      console.log('📡 Already subscribed to all conversations, skipping')
      return
    }
    
    try {
      // PATCH 3: Production only - single service, no legacy fallback
      await productionRealtimeService.initialize(userId)
      
      // Register a callback with the production realtime service
      const unsubscribe = productionRealtimeService.registerCallback(
        'realtimeCacheManager',
        (payload) => {
          console.log('🔥 [REALTIME DEBUG] Callback received in cache manager for user:', userId)

          // If this is a custom broadcast from the server (e.g., message_seen), handle it
          try {
            const event = payload?.event || payload?.type || payload?.new?.eventType;
            // Supabase broadcast uses top-level event and payload
            if (payload?.event === 'message_seen' || payload?.payload?.event === 'message_seen' || payload?.eventType === 'message_seen') {
              const broadcast = payload.payload || payload.data || {};
              console.log('📣 [REALTIME] message_seen broadcast received', broadcast)

              // Emit internal events for UI: conversation update and message read
              try {
                const receiverId = broadcast.receiverId || broadcast.receiver_id;
                const senderId = broadcast.senderId || broadcast.sender_id;
                const messageIds = broadcast.messageIds || broadcast.message_ids || [];
                const seenAt = broadcast.seenAt || broadcast.seen_at || new Date().toISOString();

                // Emit pair-aware events: handlers should derive current/other based on userId
                this.emit('conversationUpdate', { type: 'message_seen', receiverId, senderId, userId, messageIds, seenAt });
                this.emit('messageRead', { receiverId, senderId, messageIds, seenAt, by: broadcast.by });
              } catch (e) {
                console.warn('⚠️ [REALTIME] Failed to process message_seen broadcast', e);
              }
              return;
            }
          } catch (e) {}

          // Default handling path
          this.handleConversationUpdate(payload)
        }
      )
      
      // Store the unsubscribe function
      this.subscriptions.set('all_conversations', { unsubscribe })
      console.log('📡 Subscribed to all conversations for real-time cache updates via production service only')
      
    } catch (error) {
      console.error('❌ Error subscribing to all conversations:', error)
    }
  }

  // Subscribe to specific conversation for chat screen real-time updates
  async subscribeToConversation(currentUserId, otherUserId) {
    const conversationKey = `conversation_${currentUserId}_${otherUserId}`
    
    // Don't duplicate subscriptions
    if (this.subscriptions.has(conversationKey)) {
      console.log('📡 Already subscribed to conversation', conversationKey)
      return
    }

    try {
      // Make the subscription with proper error handling
      const subscription = await realtimeService.subscribeToUserMessages(
        currentUserId,
        otherUserId,
        (payload) => this.handleConversationMessageUpdate(payload, otherUserId)
      )
      
      // Validate subscription object before storing
      if (subscription && typeof subscription.unsubscribe === 'function') {
        this.subscriptions.set(conversationKey, subscription)
        console.log(`📡 Subscribed to conversation ${currentUserId} <-> ${otherUserId}`)
      } else {
        console.error(`❌ Invalid subscription object received for ${conversationKey}`, subscription)
      }
    } catch (error) {
      console.error(`❌ Error subscribing to conversation ${conversationKey}:`, error)
    }
  }

  // Unsubscribe from specific conversation when leaving chat screen
  unsubscribeFromConversation(currentUserId, otherUserId) {
    const conversationKey = `conversation_${currentUserId}_${otherUserId}`
    
    if (this.subscriptions.has(conversationKey)) {
      const subscription = this.subscriptions.get(conversationKey)
      
      // Safety check for undefined subscription or missing unsubscribe function
      if (subscription && typeof subscription.unsubscribe === 'function') {
        subscription.unsubscribe()
      } else {
        console.warn(`⚠️ Unable to unsubscribe: Invalid subscription object for ${conversationKey}`)
      }
      
      this.subscriptions.delete(conversationKey)
      console.log(`📡 Unsubscribed from conversation ${currentUserId} <-> ${otherUserId}`)
    }
  }

  // Handle real-time conversation updates for home screen
  async handleConversationUpdate(payload) {
    try {
      console.log('🔥🔥🔥 [REALTIME DEBUG] Received real-time payload:', {
        eventType: payload.eventType,
        messageId: payload.new?.id,
        senderId: payload.new?.sender_id,
        receiverId: payload.new?.receiver_id,
        currentUserId: this.currentUserId,
        hasMedia: !!payload.new?.media_url,
        timestamp: new Date().toISOString()
      })
      
      const { eventType, new: newData, old: oldData } = payload
      
      // Handle DELETE events (for account deletion or bulk message deletion)
      if (eventType === 'DELETE') {
        console.log('🗑️ [REALTIME DEBUG] Processing DELETE event - likely account deletion')
        
        // If we don't have specific message data, this might be a bulk deletion
        if (!newData || !newData.id) {
          console.log('🗑️ [REALTIME DEBUG] Bulk deletion detected - clearing all caches')
          
          // Clear all local caches as the user account was deleted
          try {
            const { default: CacheService } = await import('./cacheService')
            CacheService.clear('all')
            console.log('✅ [REALTIME DEBUG] Cleared all caches due to account deletion')
          } catch (error) {
            console.error('❌ [REALTIME DEBUG] Error clearing caches:', error)
          }
          
          // Emit event to notify UI that account was deleted
          this.emit('accountDeleted', {
            timestamp: new Date().toISOString(),
            userId: this.currentUserId
          })
          
          return // Exit early for bulk deletion
        }
      }
      
      if (eventType === 'INSERT' && newData) {
        console.log('🔥 [REALTIME DEBUG] Processing INSERT event for message:', newData.id)
        
  // NOTE: avoid global cache invalidation here. Calling apiManager.onNewMessage
  // would clear persisted message arrays (messages_currentUserId:...|otherUserId:...)
  // and break the sliding-window behavior. We perform targeted in-place updates
  // below (updateConversationCacheWithNewMessage / updateMessageCacheWithNewMessage)
  if (__DEV__) console.log('ℹ️ [CACHE] Skipping global apiManager.onNewMessage in favor of targeted updates')
        
        // Handle media for new messages
        if (newData.media_url) {
          this.handleNewMessageMedia(newData)
        }
        
        // New message received - update conversation cache
        await this.updateConversationCacheWithNewMessage(newData)
        
        // CRITICAL FIX: Also update the message cache for the specific conversation
        // This ensures ChatScreen can see new messages when reading from cache
        const otherUserId = newData.sender_id === this.currentUserId ? newData.receiver_id : newData.sender_id
        console.log('🔥 [REALTIME DEBUG] Updating message cache for conversation:', otherUserId)
        this.updateMessageCacheWithNewMessage(newData, otherUserId)
        
        // Emit event for home screen to update UI
        console.log('🔥🔥🔥 [REALTIME DEBUG] Emitting conversationUpdate event')
        this.emit('conversationUpdate', {
          type: 'newMessage',
          message: newData,
          conversationId: this.getConversationId(newData)
        })
        console.log('🔥🔥🔥 [REALTIME DEBUG] Event emitted! Listeners:', this.events['conversationUpdate']?.length || 0)
        
        // Emit event for chat screen if user is viewing this conversation
        console.log('🔥 [REALTIME DEBUG] Emitting messageReceived event')
        this.emit('messageReceived', {
          message: newData,
          conversationId: this.getConversationId(newData)
        })
      }
      
      if (eventType === 'UPDATE' && newData) {
        console.log('🔥 [REALTIME DEBUG] Processing UPDATE event for message:', newData.id)
        // Message updated (e.g., marked as seen)
        const changed = this._getChangedFields(oldData, newData)
        const otherUserId = (newData.sender_id === this.currentUserId) ? newData.receiver_id : newData.sender_id

        // Always update message cache for this conversation perspective
        this.updateMessageInCache(newData, otherUserId)

        // If this update includes read fields, emit read-specific events and update conversation caches
        if (changed.includes('seen') || changed.includes('seen_at')) {
          const seenAtTs = newData.seen_at || new Date().toISOString()

          // Emit standardized read status event for hooks (Home/Chat)
          this.emit('messageReadStatusUpdated', {
            messageId: newData.id,
            senderId: newData.sender_id,
            receiverId: newData.receiver_id,
            readerId: newData.receiver_id,
            readAt: seenAtTs,
            read: !!newData.seen,
            timestamp: Date.now()
          })

          // Update conversation caches for both sides so Home shows the double check
          try {
            this.updateConversationCacheWithReadStatus(newData.id, newData.sender_id, newData.receiver_id, seenAtTs)
          } catch (e) {
            if (__DEV__) console.warn('⚠️ [REALTIME] Failed to update conversation cache on read (handleConversationUpdate):', e)
          }

          // Emit compatibility events that some code paths listen to
          this.emit('conversationUpdate', {
            type: 'message_read',
            messageId: newData.id,
            senderId: newData.sender_id,
            receiverId: newData.receiver_id,
            timestamp: seenAtTs
          })
          this.emit('messageRead', {
            messageId: newData.id,
            senderId: newData.sender_id,
            receiverId: newData.receiver_id,
            seenAt: seenAtTs,
            by: newData.receiver_id
          })
        } else {
          // Non-read update
          this.emit('messageUpdated', {
            message: newData,
            conversationId: this.getConversationId(newData)
          })
        }
      }
      
    } catch (error) {
      console.error('❌ Error handling conversation update:', error)
    }x
  }

  // Handle media for new messages - fetch signed URLs and preload (OPTIMIZED)
  async handleNewMessageMedia(message) {
    try {
      console.log('📸 [MEDIA] Processing new message media:', message.media_url)
      
      // Check if we already have signed URL for this media
      if (CacheService.has('signedUrl', message.media_url)) {
        console.log('✅ [MEDIA] Signed URL already cached for:', message.media_url)
        // Still preload the media file if not cached locally
        this.preloadMessageMedia(message)
        return
      }

      // OPTIMIZATION: Check if we're already processing this URL to prevent duplicates
      const processingKey = `processing_${message.media_url}`
      if (this.pendingOperations && this.pendingOperations.has(processingKey)) {
        console.log('⏳ [MEDIA] Already processing signed URL for:', message.media_url)
        return
      }
      
      // Mark as being processed
      if (this.pendingOperations) {
        this.pendingOperations.add(processingKey)
      }
      
      // Fetch signed URL for the new media using unified service
      const { getSignedUrlsBatch } = await import('./unifiedMediaService')
      console.log('🌐 [MEDIA] Fetching signed URL for new message media')
      console.log(`🚨 [API_REQUEST_TRACKER] RealtimeCacheManager: CALLING getSignedUrlsBatch() from OPTIMIZED RealtimeCacheManager.handleNewMessageMedia()`)
      console.log(`🚨 [API_REQUEST_TRACKER] RealtimeCacheManager: URL:`, message.media_url.split('/').pop())
      
      try {
        await getSignedUrlsBatch([message.media_url])
        console.log('✅ [MEDIA] Signed URL cached for new message media')
        
        // Preload the media file
        this.preloadMessageMedia(message)
        
      } catch (error) {
        console.error('❌ [MEDIA] Failed to fetch signed URL for new media:', error)
      } finally {
        // Remove from pending operations
        if (this.pendingOperations) {
          this.pendingOperations.delete(processingKey)
        }
      }
    } catch (error) {
      console.error('❌ [MEDIA] Error handling new message media:', error)
    }
  }

  // Preload media file for a message
  async preloadMessageMedia(message) {
    try {
      const { unifiedMediaService } = await import('./unifiedMediaService')
      const FileSystem = await import('expo-file-system')
      
      // CRITICAL FIX: Check if media is already cached/downloading to prevent redundant operations
      const mediaUrl = message.media_url
      if (!mediaUrl) return
      
      // Extract objectKey to check cache properly
      let objectKey = null
      if (mediaUrl.startsWith('sb://media/')) {
        objectKey = mediaUrl.slice('sb://media/'.length)
      } else if (mediaUrl.includes('/media/')) {
        // Extract from signed URL
        const matches = mediaUrl.match(/\/media\/(.+?)(?:\?|$)/)
        objectKey = matches ? matches[1] : null
      }
      
      if (objectKey) {
        // Check if file already exists locally
        const isVideo = message.media_type === 'video' || message.media_url.includes('.mp4')
        const baseDir = isVideo 
          ? `${FileSystem.cacheDirectory}videos/`
          : `${FileSystem.cacheDirectory}images/`
        const localPath = `${baseDir}${objectKey}`
        
        try {
          const fileInfo = await FileSystem.getInfoAsync(localPath)
          if (fileInfo.exists) {
            console.log('✅ [MEDIA] File already cached locally, skipping redundant preload:', message.id)
            return
          }
        } catch (e) {
          // Continue with preload if file check fails
        }
      }
      
      if (message.media_type === 'video' || message.media_url.includes('.mp4')) {
        console.log('🎥 [MEDIA] Preloading video for new message:', message.id)
        unifiedMediaService.getCachedFile(message.media_url, 'video')
      } else {
        console.log('📷 [MEDIA] Preloading image for new message:', message.id)
        unifiedMediaService.getCachedFile(message.media_url, 'image')
      }
    } catch (error) {
      console.error('❌ [MEDIA] Error preloading message media:', error)
    }
  }

  // Handle real-time message updates for specific conversation (chat screen)
  handleConversationMessageUpdate(payload, otherUserId) {
    try {
      console.log('💬 Processing real-time message update for conversation:', payload.eventType, payload.new?.id)
      
      const { eventType, new: newData } = payload
      
      if (eventType === 'INSERT' && newData) {
        // Handle media for new messages in chat
        if (newData.media_url) {
          this.handleNewMessageMedia(newData)
        }
        
        // Update message cache for this conversation
        this.updateMessageCacheWithNewMessage(newData, otherUserId)
        
        // Emit event for chat screen to update UI
        this.emit('chatMessageReceived', {
          message: newData,
          otherUserId: otherUserId
        })
      }
      
      if (eventType === 'UPDATE' && newData) {
        // Update message in cache
        this.updateMessageInCache(newData, otherUserId)
        
        // Emit event for chat screen to update UI
        this.emit('chatMessageUpdated', {
          message: newData,
          otherUserId: otherUserId
        })
      }
      
    } catch (error) {
      console.error('❌ Error handling conversation message update:', error)
    }
  }

  // Update conversation cache with new message (for home screen)
  async updateConversationCacheWithNewMessage(message) {
    try {
      // Safety check: ensure CacheService is available
      if (!CacheService || typeof CacheService.get !== 'function') {
        console.warn('⚠️ CacheService not available for conversation cache update')
        return
      }

      console.log('🔥🔥🔥 [CACHE] Updating conversation cache with message:', message.id)

      // CRITICAL FIX: Update cache for BOTH users with correct perspective
      await this.updateUserConversationCache(message, message.sender_id)
      await this.updateUserConversationCache(message, message.receiver_id)
      
    } catch (error) {
      console.error('❌ Error updating conversation cache:', error)
    }
  }

  // Update conversation cache for a specific user with correct perspective
  async updateUserConversationCache(message, forUserId) {
    try {
      console.log('🔥🔥🔥 [CACHE] Updating conversation cache for user:', forUserId, 'message:', message.id)

      // Debug - log the full message
      console.log('🔥🔥🔥 [CACHE] Message data:', JSON.stringify(message, null, 2))

      // Get current conversations from cache using centralized method
      const userCacheKey = `conversations_${forUserId}`
      let conversations = this.getAllConversationCaches(forUserId) || []
      
      // Ensure conversations is an array even if somehow cache returned invalid data
      if (!Array.isArray(conversations)) {
        console.warn('⚠️ Cache returned invalid conversations format, resetting to empty array')
        conversations = []
      }
      
      // Create a deep copy to avoid mutation issues
      conversations = JSON.parse(JSON.stringify(conversations))
      console.log('🔥🔥🔥 [CACHE] Found conversations in cache:', conversations.length, 'using key:', userCacheKey)
      
      // Find the conversation this message belongs to - from THIS user's perspective
      const otherUserId = message.sender_id === forUserId ? message.receiver_id : message.sender_id
      if (__DEV__) console.log('🔥🔥🔥 [CACHE] Looking for conversation with user:', otherUserId, 'from perspective of:', forUserId)
      
      // Improved conversation matching by checking multiple possible ID fields
      const conversationIndex = conversations.findIndex(conv => {
        // Make sure the conversation object has the necessary fields
        if (!conv) return false;
        
        // Find conversation by calculating the other user ID from sender/receiver
        // or by direct comparison with conversation ID fields
        const convOtherUserId = conv.sender_id === forUserId ? conv.receiver_id : conv.sender_id;
        
        return (
          convOtherUserId === otherUserId || 
          conv.id === otherUserId || 
          conv.contact_id === otherUserId ||
          (conv.otherUser && conv.otherUser.id === otherUserId)
        );
      });
      
      if (conversationIndex >= 0) {
        console.log('🔥🔥🔥 [CACHE] Found existing conversation at index:', conversationIndex, 'for user:', forUserId)
        // Get existing conversation as a deep copy, not a reference
        const conversation = JSON.parse(JSON.stringify(conversations[conversationIndex]))
        
        // Log the conversation before update
        console.log('🔥🔥🔥 [CACHE] Conversation before update:', JSON.stringify(conversation, null, 2))
        
        // Only update specific fields, preserve other important conversation data
        const updatedConversation = {
          ...conversation, // Keep all existing fields
          last_message: message.caption || (message.media_type === 'photo' ? '📷 Photo' : '🎥 Video'),
          last_message_time: message.created_at,
          last_message_id: message.id,
          // Ensure ID fields are set correctly for consistency
          id: conversation.id || otherUserId,
          contact_id: conversation.contact_id || otherUserId
          ,
          // Store explicit sender/receiver of the latest message for home-screen logic
          sender_id: message.sender_id,
          receiver_id: message.receiver_id,
        }
        
        // Only update media fields if the new message has media
        if (message.media_url) {
          updatedConversation.media_url = message.media_url
          updatedConversation.media_type = message.media_type
          updatedConversation.thumbnail_url = message.thumbnail_url
          updatedConversation.latestMediaType = message.media_type
          updatedConversation.latestMediaUrl = message.media_url
          updatedConversation.latestThumbnailUrl = message.thumbnail_url
        }
        
        // Update caption, view_once and is_nsfw if present
        if (message.caption) updatedConversation.caption = message.caption
        if (message.view_once !== undefined) updatedConversation.view_once = message.view_once
        if (message.is_nsfw !== undefined) updatedConversation.is_nsfw = message.is_nsfw
        
        // FIXED LOGIC: Smart indicator management for sequential messages
        if (message.sender_id === forUserId) {
          // User SENT this message
          
          // For sent messages, we need to be smart about the seen status:
          // - If this is replacing an optimistic message (has _tempId), preserve existing seen status
          // - If this is a brand new message, start with seen = false
          // - If previous message was already read (seen = true), don't reset it unless this is a newer message
          
          const isOptimisticReplacement = message._tempId || message._isOptimisticReplacement || conversation.last_message_id?.startsWith('temp_')
          const wasAlreadyRead = conversation.seen === true
          const isNewerMessage = new Date(message.created_at) > new Date(conversation.last_message_time || 0)
          
          // Additional safeguard: if the conversation was recently marked as read (seen=true),
          // and this message is from the same time period, it might be a duplicate/reorder
          const messageTime = new Date(message.created_at)
          const lastMessageTime = new Date(conversation.last_message_time || 0)
          const timeDiffSeconds = Math.abs(messageTime - lastMessageTime) / 1000
          const isPotentialDuplicate = timeDiffSeconds < 2 && wasAlreadyRead
          
          console.log('🔍 [CACHE] Analyzing sent message update:', {
            messageId: message.id,
            tempId: message._tempId,
            isOptimisticReplacement,
            wasAlreadyRead,
            isNewerMessage,
            isPotentialDuplicate,
            timeDiffSeconds,
            currentSeen: conversation.seen,
            messageTime: message.created_at,
            lastMessageTime: conversation.last_message_time
          })
          
          // Sender-side: prefer to preserve existing conversation.seen unless the message
          // payload explicitly indicates it was read. Do NOT force seen=false here because
          // that causes false UI flips (sender reopens chat -> seen=false).
          const messageIndicatesRead = !!(message.seen === true || message.read === true || message.read_at);
          if (messageIndicatesRead) {
            updatedConversation.seen = true;
            if (__DEV__) console.log('🔍 [CACHE] Message payload indicates read; marking seen=true');
          } else {
            // Keep prior seen value (server is source of truth for read state)
            updatedConversation.seen = conversation.seen;
            if (__DEV__) console.log('🔍 [CACHE] Preserving existing seen state for sender (no explicit read flag in message)');
          }
          
          updatedConversation.has_new_message = false; // Sender doesn't see "new message" for their own message
        } else {
          // User RECEIVED this message - they didn't send it, so no read indicator for them
          updatedConversation.seen = null; // Receiver doesn't get read indicators (they didn't send the message)
          updatedConversation.has_new_message = true; // Show new message indicator
          console.log('🔥 [CACHE] User', forUserId, 'RECEIVED this message - no read indicator (seen=null), show new indicator');
        }
        
        // Ensure otherUser data is preserved
        if (!updatedConversation.otherUser && conversation.otherUser) {
          updatedConversation.otherUser = conversation.otherUser;
        }
        
        // Log the conversation after update
        console.log('🔥🔥🔥 [CACHE] Conversation after update for user', forUserId, ':', JSON.stringify(updatedConversation, null, 2))
        
        // Move conversation to top
        conversations.splice(conversationIndex, 1)
        conversations.unshift(updatedConversation)
        
        console.log('📦 Updated existing conversation in cache with new message')
      } else {
        // If conversation doesn't exist in cache, fetch user info and create a new conversation entry
        if (__DEV__) console.log('⚠️ Conversation not found in cache for new message from: ' + otherUserId)
        
        // Always try to fetch real user info first - this is critical for new conversations
        let userInfo = null
        try {
          if (__DEV__) console.log('� Fetching user info immediately for new conversation:', otherUserId)
          userInfo = await this.fetchUserInfoSync(otherUserId)
          if (__DEV__) console.log('✅ Successfully fetched user info:', userInfo.pseudo)
        } catch (error) {
          console.error('❌ Error fetching user info for new conversation:', error)
          // Create a better placeholder that will be updated
          const shortId = otherUserId.substring(0, 6)
          userInfo = {
            id: otherUserId,
            pseudo: `User #${shortId}`
          }
        }
        
        const newConversation = {
          id: otherUserId,
          contact_id: otherUserId,
          sender_id: message.sender_id,
          receiver_id: message.receiver_id,
          last_message: message.caption || (message.media_type === 'photo' ? '📷 Photo' : '🎥 Video'),
          last_message_time: message.created_at,
          last_message_id: message.id,
          media_url: message.media_url,
          media_type: message.media_type,
          caption: message.caption,
          view_once: message.view_once,
          is_nsfw: message.is_nsfw,
          seen: message.sender_id === forUserId ? false : null, // Only show read indicators if current user sent the message
          thumbnail_url: message.thumbnail_url,
          latestMediaType: message.media_type,
          latestMediaUrl: message.media_url,
          latestThumbnailUrl: message.thumbnail_url,
          created_at: message.created_at,
          has_new_message: message.sender_id !== forUserId, // Only show new message indicator if current user received it
          otherUser: userInfo
        }
        
        // Add to beginning of conversations array
        conversations.unshift(newConversation)
        console.log('📦 Created new conversation entry for user', forUserId, ':', userInfo.pseudo)
        
        // If we used a placeholder, try to fetch real info async
        if (userInfo.pseudo.startsWith('User #')) {
          this.fetchUserInfoAsync(otherUserId).catch(err => {
            console.error('❌ Error fetching user info async for new conversation:', err)
          })
        }
      }
      
      // Log a sample of conversations to help debug
      if (conversations.length > 0) {
        console.log('🔍 First conversation sample:', JSON.stringify({
          id: conversations[0].id,
          contact_id: conversations[0].contact_id,
          last_message: conversations[0].last_message,
          otherUser: conversations[0].otherUser
        }))
        
        if (conversations.length > 1) {
          console.log('🔍 Second conversation sample:', JSON.stringify({
            id: conversations[1].id,
            contact_id: conversations[1].contact_id,
            last_message: conversations[1].last_message,
            otherUser: conversations[1].otherUser
          }))
        }
      }

      // Validate and fix conversation data if needed
      const hasFixedData = this.validateAndFixConversationData(conversations)
      if (hasFixedData) {
        console.log('🔧 Fixed inconsistent conversation data before caching')
      }
      
      // Remove any duplicate conversations based on ID
      const uniqueConversations = this.removeDuplicateConversations(conversations)
      if (uniqueConversations.length !== conversations.length) {
        console.log(`🧹 Removed ${conversations.length - uniqueConversations.length} duplicate conversations`)
        conversations = uniqueConversations
      }
      
      // Safety check to prevent empty or invalid cache
      if (Array.isArray(conversations) && conversations.length > 0) {
        // Use centralized cache management to ensure consistency - MARK AS REAL-TIME UPDATE
        this.updateAllConversationCaches(forUserId, conversations, true)
        console.log('🔥🔥🔥 [CACHE] Updated conversation cache for user', forUserId, 'with', conversations.length, 'conversations using centralized cache management (REAL-TIME)')
        
        // Only emit event if this is for the current user viewing the app
        if (forUserId === this.currentUserId) {
          this.emit('conversationListUpdated', { 
            conversationCount: conversations.length,
            fullUpdate: true,
            timestamp: new Date().toISOString()
          })
        }
      } else {
        console.error('❌ Not updating cache - conversations array is invalid for user:', forUserId, conversations)
      }
      
    } catch (error) {
      console.error('❌ Error updating conversation cache:', error)
    }
  }

  // Update message cache with new message (for chat screen)
  updateMessageCacheWithNewMessage(message, otherUserId) {
    try {
      // Safety check: ensure CacheService is available
      if (!CacheService || typeof CacheService.get !== 'function') {
        console.warn('⚠️ CacheService not available for message cache update')
        return
      }

      // CRITICAL FIX: Use the same cache key format as apiManager
      // apiManager uses: messages_currentUserId:xxx|otherUserId:yyy
      const cacheKey = `messages_currentUserId:${this.currentUserId}|otherUserId:${otherUserId}`
      
      // Also update the old format for backward compatibility
      const oldCacheKey = `${otherUserId}_messages`
      
      // Get messages from either cache format (ensure array)
      let messages = apiManager.getFromCache(cacheKey)
      if (!Array.isArray(messages)) {
        messages = CacheService.get('message', oldCacheKey) || []
      }
      if (!Array.isArray(messages)) messages = []

      // Helper to robustly match optimistic <-> real messages
      const matchesExisting = (existing) => {
        if (!existing) return false
        try {
          if (message.id && existing.id === message.id) return true
          // Match on existing having a temp id that equals incoming real id
          if (message.id && (existing._tempId === message.id || existing.tempId === message.id)) return true
          // Match on incoming having temp id matching existing id
          if ((message._tempId || message.tempId) && existing.id && (existing.id === message._tempId || existing.id === message.tempId)) return true
          // Match on explicit temp id fields
          if (message._tempId && (existing._tempId === message._tempId || existing.tempId === message._tempId)) return true
          if (message.tempId && (existing._tempId === message.tempId || existing.tempId === message.tempId)) return true
        } catch (e) {
          // defensive
        }
        return false
      }

      // Try to find an existing message to replace (optimistic -> real replacement)
      const existingIndex = messages.findIndex(matchesExisting)

      if (existingIndex >= 0) {
        // Replace existing optimistic entry with the authoritative one
        const preserved = messages[existingIndex]
        messages[existingIndex] = {
          // preserve some client-only flags if present, but prefer server fields
          ...preserved,
          ...message,
          _isSending: false,
          _isOptimisticReplacement: false
        }
        if (__DEV__) console.log('🔁 Replaced optimistic message in cache with real message:', message.id, 'at index', existingIndex)
      } else {
        // Append the incoming message to the end (newest)
        messages.push(message)
        if (__DEV__) console.log('➕ Appended new message to cache for conversation', otherUserId, message.id)
      }

      // Deduplicate: prefer non-optimistic messages when duplicates exist
      const seen = new Set()
      const dedupedReversed = []
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (!m) continue
        const ids = [m.id, m._tempId, m.tempId].filter(Boolean)
        const already = ids.some(id => seen.has(id))
        if (already) continue
        // mark all id variants as seen
        ids.forEach(id => seen.add(id))
        dedupedReversed.push(m)
      }
      const merged = dedupedReversed.reverse()

      // Persist merged messages back to both caches
      apiManager.setCache(cacheKey, merged)
      CacheService.set('message', oldCacheKey, merged, { ttl: 24 * 60 * 60 * 1000 }) // 24 hours

      if (__DEV__) {
        console.log('📦 Updated message cache with merged message for conversation', otherUserId, '- Total messages:', merged.length)
        console.log('📦 Cache key used:', cacheKey)
      }
      
    } catch (error) {
      console.error('❌ Error updating message cache:', error)
    }
  }

  // Update specific message in cache (for seen status, etc.)
  updateMessageInCache(updatedMessage, otherUserId = null) {
    try {
      // Update in conversation cache if needed
      this.updateMessageInConversationCache(updatedMessage)
      
      // Update in message cache if we have the conversation cached
      if (otherUserId) {
        // CRITICAL FIX: Use the same cache key format as apiManager
        const cacheKey = `messages_currentUserId:${this.currentUserId}|otherUserId:${otherUserId}`
        const oldCacheKey = `${otherUserId}_messages`
        
        // Get messages from either cache format
        let messages = apiManager.getFromCache(cacheKey)
        if (!Array.isArray(messages)) {
          messages = CacheService.get('message', oldCacheKey) || []
        }
        if (!Array.isArray(messages)) messages = []

        // Reuse matching heuristics to find optimistic replacements
        const matchesExisting = (existing) => {
          if (!existing) return false
          try {
            if (updatedMessage.id && existing.id === updatedMessage.id) return true
            if (updatedMessage.id && (existing._tempId === updatedMessage.id || existing.tempId === updatedMessage.id)) return true
            if ((updatedMessage._tempId || updatedMessage.tempId) && existing.id && (existing.id === updatedMessage._tempId || existing.id === updatedMessage.tempId)) return true
            if (updatedMessage._tempId && (existing._tempId === updatedMessage._tempId || existing.tempId === updatedMessage._tempId)) return true
            if (updatedMessage.tempId && (existing._tempId === updatedMessage.tempId || existing.tempId === updatedMessage.tempId)) return true
          } catch (e) {
            // defensive
          }
          return false
        }

        const messageIndex = messages.findIndex(matchesExisting)
        if (messageIndex >= 0) {
          // Merge message fields, prefer server-supplied fields but preserve client-only flags
          const preserved = messages[messageIndex]
          messages[messageIndex] = { ...preserved, ...updatedMessage }

          // Persist merged array
          apiManager.setCache(cacheKey, messages)
          CacheService.set('message', oldCacheKey, messages, { ttl: 24 * 60 * 60 * 1000 }) // 24 hours

          console.log('📦 Updated message in cache (merged):', updatedMessage.id || updatedMessage._tempId, '- Total messages:', messages.length)
          console.log('📦 Updated message seen status:', updatedMessage.seen, 'for message:', updatedMessage.id || updatedMessage._tempId)
        } else {
          console.warn('⚠️ Could not find message to update in cache (no matching id/tempId):', updatedMessage.id || updatedMessage._tempId)
        }
      }
      
    } catch (error) {
      console.error('❌ Error updating message in cache:', error)
    }
  }

  // Handle messageRead events
  async handleMessageReadEvent(data) {
    try {
      console.log('📖 [REALTIME] Processing messageRead event:', data.messageId, 'isNsfw:', data.isNsfw)
      
      // Update read status for ALL messages, not just NSFW
      const senderId = data.senderId;
      const receiverId = data.receiverId;
      
      console.log('👤 [REALTIME] Updating read status for message:', data.messageId, 'sender:', senderId, 'receiver:', receiverId)
      
      // 1. Update message caches for both sender and receiver (ASYNC - same as new messages)
      await this.updateMessageReadStatus(data.messageId, senderId, receiverId, data.timestamp, data.isNsfw);
      
  // NOTE: avoid global cache invalidation for message read events. Previously
  // calling apiManager.onMessageRead would clear persisted message arrays and
  // cause sliding-window history loss. Read-status updates are handled in-place
  // by updateMessageReadStatus and conversation cache updates above.
  if (__DEV__) console.log('ℹ️ [CACHE] Skipping global apiManager.onMessageRead; using in-place read updates')
      
      // Emit standard read event for all messages
      this.emit('messageReadStatusUpdated', {
        messageId: data.messageId,
        senderId: senderId,
        receiverId: receiverId,
        timestamp: data.timestamp,
        isNsfw: data.isNsfw,
      })
      
      console.log('✅ [REALTIME] Message read status updated')

      // 3. CRITICAL: Emit global events for HomeScreen updates (EXACT SAME as new messages)
      console.log('🔥🔥🔥 [REALTIME DEBUG] Emitting conversationUpdate event for message read (SAME as new messages)')
      this.emit('conversationUpdate', {
        type: 'message_read',
        messageId: data.messageId,
        senderId: senderId,
        receiverId: receiverId,
        timestamp: data.timestamp,
        isNsfw: data.isNsfw,
        conversationId: this.getConversationId({ sender_id: senderId, receiver_id: receiverId })
      })
      console.log('🔥🔥🔥 [REALTIME DEBUG] Event emitted! Listeners:', this.events['conversationUpdate']?.length || 0)
      
      console.log('🔥 [REALTIME DEBUG] Emitting messageReceived event for read status update (SAME as new messages)')
      this.emit('messageReceived', {
        type: 'message_read',
        messageId: data.messageId,
        senderId: senderId,
        receiverId: receiverId,
        timestamp: data.timestamp,
        isNsfw: data.isNsfw,
        // Include the users involved so HomeScreen can update the right conversation
        users: [senderId, receiverId],
        // Add conversationId for better tracking - this should be the OTHER user for each perspective
        conversationId: receiverId // This will be used by sender to identify their conversation with receiver
      })
    } catch (error) {
      console.error('❌ Error handling messageRead event:', error)
    }
  }
  
  // New method to update read status for all message types
  async updateMessageReadStatus(messageId, senderId, receiverId, timestamp, isNsfw) {
    try {
      console.log('📖 [REALTIME] Updating read status for message:', messageId)
      
      // Update sender's message cache to show message as read
      const senderCacheKey = `${receiverId}_messages` // Sender's conversation with receiver
      const senderMessages = CacheService.get('message', senderCacheKey) || []
      
      const senderMessageIndex = senderMessages.findIndex(msg => msg.id === messageId)
      if (senderMessageIndex >= 0) {
        senderMessages[senderMessageIndex] = {
          ...senderMessages[senderMessageIndex],
          seen: true,
          viewed_at: timestamp
        }
        CacheService.set('message', senderCacheKey, senderMessages)
        console.log('✅ [REALTIME] Updated sender message cache for read status')
      }
      
      // Update receiver's message cache to show message as read
      const receiverCacheKey = `${senderId}_messages` // Receiver's conversation with sender
      const receiverMessages = CacheService.get('message', receiverCacheKey) || []
      
      const receiverMessageIndex = receiverMessages.findIndex(msg => msg.id === messageId)
      if (receiverMessageIndex >= 0) {
        receiverMessages[receiverMessageIndex] = {
          ...receiverMessages[receiverMessageIndex],
          seen: true,
          viewed_at: timestamp
        }
        CacheService.set('message', receiverCacheKey, receiverMessages)
        console.log('✅ [REALTIME] Updated receiver message cache for read status')
      }
      
      // Update conversation caches for both users using simple proven method
      this.updateConversationReadStatus(messageId, senderId, receiverId, timestamp)
      
    } catch (error) {
      console.error('❌ Error updating message read status:', error)
    }
  }
  
  // NEW METHOD: Update conversation cache with read status (same pattern as updateConversationCacheWithNewMessage)
  async updateConversationCacheWithReadStatus(messageId, senderId, receiverId, timestamp) {
    try {
      console.log('🔥🔥🔥 [READ_CACHE] Updating conversation cache with read status:', messageId)

      // CRITICAL: Update cache for BOTH users with correct read status perspective (same as new messages)
      await this.updateUserConversationCacheForReadStatus(messageId, senderId, receiverId, timestamp, senderId)   // Update sender's cache
      await this.updateUserConversationCacheForReadStatus(messageId, senderId, receiverId, timestamp, receiverId) // Update receiver's cache
      
    } catch (error) {
      console.error('❌ Error updating conversation cache with read status:', error)
    }
  }
  
  // NEW METHOD: Update user conversation cache for read status (mirrors updateUserConversationCache logic)
  async updateUserConversationCacheForReadStatus(messageId, senderId, receiverId, timestamp, forUserId) {
    try {
      console.log('🔥🔥🔥 [READ_CACHE] Updating conversation cache for user:', forUserId, 'read status for message:', messageId)

      // Get current conversations from cache using centralized method (SAME as new message handling)
      let conversations = this.getAllConversationCaches(forUserId) || []
      
      if (!Array.isArray(conversations)) {
        console.warn('⚠️ Cache returned invalid conversations format for read status, resetting to empty array')
        conversations = []
      }
      
      // Create a deep copy to avoid mutation issues (SAME as new message handling)
      conversations = JSON.parse(JSON.stringify(conversations))
      console.log('🔥🔥🔥 [READ_CACHE] Found conversations in cache:', conversations.length, 'for user:', forUserId)
      
      // Find the conversation this read status belongs to
      const otherUserId = senderId === forUserId ? receiverId : senderId
      console.log('🔥🔥🔥 [READ_CACHE] Looking for conversation with user:', otherUserId, 'from perspective of:', forUserId)
      
      const conversationIndex = conversations.findIndex(conv => {
        if (!conv) return false
        
        const convOtherUserId = conv.sender_id === forUserId ? conv.receiver_id : conv.sender_id
        
        return (
          convOtherUserId === otherUserId || 
          conv.id === otherUserId || 
          conv.contact_id === otherUserId ||
          (conv.otherUser && conv.otherUser.id === otherUserId) ||
          conv.last_message_id === messageId
        )
      })
      
      if (conversationIndex >= 0) {
        console.log('🔥🔥🔥 [READ_CACHE] Found conversation at index:', conversationIndex, 'for user:', forUserId)
        
        // Get existing conversation as a deep copy (SAME as new message handling)
        const conversation = JSON.parse(JSON.stringify(conversations[conversationIndex]))
        
        // Log the conversation before update
        console.log('🔥🔥🔥 [READ_CACHE] Conversation before read update:', JSON.stringify({
          id: conversation.id,
          seen: conversation.seen,
          has_new_message: conversation.has_new_message,
          last_message_id: conversation.last_message_id
        }))
        
        // Update read status based on user role
        const updatedConversation = { ...conversation }
        
        if (forUserId === senderId) {
          // For sender: their message was read, show double checkmark
          updatedConversation.seen = true
          updatedConversation.last_seen = true
          updatedConversation.last_seen_at = timestamp
          updatedConversation.has_new_message = false
          console.log('🔥 [READ_CACHE] User', forUserId, 'is SENDER - message was read, set seen=true')
        } else {
          // For receiver: they read the message, clear new message indicator
          updatedConversation.has_new_message = false
          // For receiver, the last message is now seen from their perspective
          if (updatedConversation.last_message_id === messageId) {
            updatedConversation.last_seen = true
            updatedConversation.last_seen_at = timestamp
          }
          console.log('🔥 [READ_CACHE] User', forUserId, 'is RECEIVER - they read message, clear has_new_message')
        }
        
        // Log the conversation after update
        console.log('🔥🔥🔥 [READ_CACHE] Conversation after read update:', JSON.stringify({
          id: updatedConversation.id,
          seen: updatedConversation.seen,
          has_new_message: updatedConversation.has_new_message,
          last_message_id: updatedConversation.last_message_id
        }))
        
        // Update conversation in array
        conversations[conversationIndex] = updatedConversation
        
        console.log('📦 Updated existing conversation with read status')
      } else {
        console.log('⚠️ Conversation not found for read status update - this should not happen for existing messages')
        return // Don't create new conversations for read status updates
      }
      
      // Use centralized cache management to ensure consistency - MARK AS REAL-TIME UPDATE (SAME as new messages)
      this.updateAllConversationCaches(forUserId, conversations, true)
      console.log('🔥🔥🔥 [READ_CACHE] Updated conversation cache for user', forUserId, 'with read status using centralized cache management (REAL-TIME)')
      
      // Only emit event if this is for the current user viewing the app (SAME as new messages)
      if (forUserId === this.currentUserId) {
        this.emit('conversationListUpdated', { 
          conversationCount: conversations.length,
          fullUpdate: true,
          timestamp: new Date().toISOString(),
          updateType: 'read_status'
        })
      }
      
    } catch (error) {
      console.error('❌ Error updating user conversation cache for read status:', error)
    }
  }
  
  // Update conversation read status for both users
  updateConversationReadStatus(messageId, senderId, receiverId, timestamp) {
    try {
      // SIMPLE LOGIC: Only sender gets seen: true when their message is read
      
      // Update sender's conversation cache (person who sent the message that was read)
      const senderConversationKey = `conversations_${senderId}`
      let senderConversations = this.getAllConversationCaches(senderId) || []
      
      console.log('🔍 [REALTIME] Looking for sender conversation to update read status')
      console.log('🔍 [REALTIME] Sender conversation key:', senderConversationKey)
      console.log('🔍 [REALTIME] Sender conversations count:', senderConversations.length)
      console.log('🔍 [REALTIME] Looking for conversation with receiver:', receiverId, 'or message:', messageId)
      
      // Since we're using centralized cache management, the getAllConversationCaches method
      // already handles cache lookup with proper fallback logic
      
      console.log('� [REALTIME] Sender conversations from centralized cache:', senderConversations.length)
      
      // For sender: find the conversation with the person who read their message
      const senderConvIndex = senderConversations.findIndex(conv => {
        // Find conversation with the receiver (person who read the message)
        const isMatchByOtherUser = (conv.contact_id === receiverId) || 
                                  (conv.otherUser && conv.otherUser.id === receiverId) ||
                                  (conv.id === receiverId)
        
        const isMatchByMessage = conv.last_message_id === messageId
        
        console.log('🔍 [REALTIME] Checking sender conversation:', {
          convId: conv.id,
          contactId: conv.contact_id,
          otherUserId: conv.otherUser?.id,
          lookingForReceiver: receiverId,
          lastMessageId: conv.last_message_id,
          messageId: messageId,
          isMatchByOtherUser,
          isMatchByMessage
        })
        
        return isMatchByOtherUser || isMatchByMessage
      })
      
      if (senderConvIndex >= 0) {
        console.log('✅ [REALTIME] Found sender conversation at index:', senderConvIndex)
        
        // Log conversation before update
        console.log('🔍 [READ_DEBUG] Sender conversation BEFORE update:', JSON.stringify({
          id: senderConversations[senderConvIndex].id,
          contact_id: senderConversations[senderConvIndex].contact_id,
          seen: senderConversations[senderConvIndex].seen,
          has_new_message: senderConversations[senderConvIndex].has_new_message,
          last_message_id: senderConversations[senderConvIndex].last_message_id
        }))
        
        // For sender: show "read" indicator (their sent message was read)
        senderConversations[senderConvIndex] = {
          ...senderConversations[senderConvIndex],
          seen: true,
          has_new_message: false // Clear any new message indicator
        }
        
        // Log conversation after update
        console.log('🔍 [READ_DEBUG] Sender conversation AFTER update:', JSON.stringify({
          id: senderConversations[senderConvIndex].id,
          contact_id: senderConversations[senderConvIndex].contact_id,
          seen: senderConversations[senderConvIndex].seen,
          has_new_message: senderConversations[senderConvIndex].has_new_message,
          last_message_id: senderConversations[senderConvIndex].last_message_id
        }))
        
        // CRITICAL: Use centralized cache management with immediate persistence
        this.updateAllConversationCaches(senderId, senderConversations, true)
        console.log('✅ [REALTIME] Updated sender conversation cache for read status (seen: true, has_new_message: false)')
      } else {
        console.log('❌ [REALTIME] Could not find sender conversation to update for read status')
      }
      
      // Update receiver's conversation cache (person who read the message)
      const receiverConversationKey = `conversations_${receiverId}`
      let receiverConversations = this.getAllConversationCaches(receiverId) || []
      
      console.log('🔍 [REALTIME] Looking for receiver conversation to update read status')
      console.log('🔍 [REALTIME] Receiver conversation key:', receiverConversationKey)
      console.log('🔍 [REALTIME] Receiver conversations count:', receiverConversations.length)
      
      // Since we're using centralized cache management, the getAllConversationCaches method
      // already handles cache lookup with proper fallback logic
      
      // For receiver: find the conversation with the person who sent the message they just read
      const receiverConvIndex = receiverConversations.findIndex(conv => {
        // Find conversation with the sender (person who sent the message they read)
        const isMatchByOtherUser = (conv.contact_id === senderId) || 
                                  (conv.otherUser && conv.otherUser.id === senderId) ||
                                  (conv.id === senderId)
        
        const isMatchByMessage = conv.last_message_id === messageId
        
        console.log('🔍 [REALTIME] Checking receiver conversation:', {
          convId: conv.id,
          contactId: conv.contact_id,
          otherUserId: conv.otherUser?.id,
          lookingForSender: senderId,
          lastMessageId: conv.last_message_id,
          messageId: messageId,
          isMatchByOtherUser,
          isMatchByMessage
        })
        
        return isMatchByOtherUser || isMatchByMessage
      })
      
      if (receiverConvIndex >= 0) {
        console.log('✅ [REALTIME] Found receiver conversation at index:', receiverConvIndex)
        // For receiver: clear the new message indicator since they read the message
        receiverConversations[receiverConvIndex] = {
          ...receiverConversations[receiverConvIndex],
          has_new_message: false // Clear new message indicator
        }
        // CRITICAL: Use centralized cache management with immediate persistence
        this.updateAllConversationCaches(receiverId, receiverConversations, true)
        console.log('✅ [REALTIME] Updated receiver conversation cache for read status (has_new_message: false)')
      } else {
        console.log('❌ [REALTIME] Could not find receiver conversation to update for read status')
      }
      
      // SIMPLIFIED: Remove global cache updates since we're using unified cache only
      console.log('✅ [REALTIME] Skipping global cache updates - using unified cache architecture')
      
      // Emit events to update UI for both users
      if (senderConvIndex >= 0 && senderId === this.currentUserId) {
        // Sender sees their message was read
        this.emit('conversationListUpdated', {
          type: 'message_read_by_other',
          messageId: messageId,
          timestamp: timestamp,
          userId: senderId
        })
        
        // CRITICAL: Force immediate UI updates with multiple aggressive event types
        console.log('🚨 [IMMEDIATE_UPDATE] Forcing UI update for sender read status change:', messageId)
        console.log('🚨 [IMMEDIATE_UPDATE] Sender is current user:', senderId, '=== currentUserId:', this.currentUserId)
        
        // 1. Emit conversationUpdate event with force flag
        this.emit('conversationUpdate', {
          type: 'message_read',
          messageId: messageId,
          senderId: senderId,
          receiverId: receiverId,
          timestamp: timestamp,
          forceUpdate: true,
          eventSource: 'sender_read_status'
        })
        console.log('🚨 [IMMEDIATE_UPDATE] 1. Emitted conversationUpdate event')
        
        // 2. Emit messageReceived event with force flag
        this.emit('messageReceived', {
          type: 'message_read',
          messageId: messageId,
          senderId: senderId,
          receiverId: receiverId,
          timestamp: timestamp,
          forceUpdate: true,
          eventSource: 'sender_read_status'
        })
        console.log('🚨 [IMMEDIATE_UPDATE] 2. Emitted messageReceived event')
        
        // 3. Emit specific read status update event
        this.emit('readStatusUpdate', {
          messageId: messageId,
          senderId: senderId,
          receiverId: receiverId,
          timestamp: timestamp,
          userRole: 'sender',
          seen: true
        })
        console.log('🚨 [IMMEDIATE_UPDATE] 3. Emitted readStatusUpdate event')
        
        // 4. Emit conversationListUpdated event for HomeScreen
        this.emit('conversationListUpdated', {
          type: 'message_read_by_other',
          messageId: messageId,
          timestamp: timestamp,
          userId: senderId,
          forceUpdate: true
        })
        console.log('🚨 [IMMEDIATE_UPDATE] 4. Emitted conversationListUpdated event')
        
        console.log('🚨 [IMMEDIATE_UPDATE] All sender read status events emitted')
        console.log('🚨 [IMMEDIATE_UPDATE] Event listeners count:', {
          conversationUpdate: this.events['conversationUpdate']?.length || 0,
          messageReceived: this.events['messageReceived']?.length || 0,
          readStatusUpdate: this.events['readStatusUpdate']?.length || 0,
          conversationListUpdated: this.events['conversationListUpdated']?.length || 0
        })
      }
      
      if (receiverConvIndex >= 0 && receiverId === this.currentUserId) {
        // Receiver cleared their new message indicator
        this.emit('conversationListUpdated', {
          type: 'message_read_by_me', 
          messageId: messageId,
          timestamp: timestamp,
          userId: receiverId
        })
        
        // CRITICAL: Also emit conversationUpdate event for immediate UI updates
        this.emit('conversationUpdate', {
          type: 'message_read',
          messageId: messageId,
          senderId: senderId,
          receiverId: receiverId,
          timestamp: timestamp
        })
        
        // CRITICAL: Also emit messageReceived event for HomeScreen handlers
        this.emit('messageReceived', {
          type: 'message_read',
          messageId: messageId,
          senderId: senderId,
          receiverId: receiverId,
          timestamp: timestamp
        })
      }
      
    } catch (error) {
      console.error('❌ Error updating conversation read status:', error)
    }
  }

  // Update message in conversation cache (for seen status updates)
  async updateMessageInConversationCache(updatedMessage) {
    try {
      const userCacheKey = `conversations_${this.currentUserId}`
      const conversations = CacheService.get('conversation', userCacheKey) || CacheService.get('conversation', 'all') || []
      
      // Find conversation that contains this message - not just by last_message_id 
      // but by checking if this message belongs to this conversation
      const conversationIndex = conversations.findIndex(conv => {
        const otherUserId = updatedMessage.sender_id === this.currentUserId 
          ? updatedMessage.receiver_id 
          : updatedMessage.sender_id
        
        const convOtherUserId = conv.sender_id === this.currentUserId 
          ? conv.receiver_id 
          : conv.sender_id
          
        return convOtherUserId === otherUserId ||
               conv.id === otherUserId ||
               conv.contact_id === otherUserId ||
               (conv.otherUser && conv.otherUser.id === otherUserId) ||
               conv.last_message_id === updatedMessage.id
      })
      
      if (conversationIndex >= 0) {
        const conversation = conversations[conversationIndex]
        
        // If message was marked as seen and current user is the receiver, 
        // check if there are any other unseen messages in this conversation
        if (updatedMessage.seen && updatedMessage.receiver_id === this.currentUserId) {
          console.log('📖 [CACHE] Message marked as seen, checking if conversation should remove new message indicator')
          
          // Get all messages for this conversation to check if any are still unseen
          const otherUserId = updatedMessage.sender_id === this.currentUserId 
            ? updatedMessage.receiver_id 
            : updatedMessage.sender_id
          const messagesCacheKey = `${otherUserId}_messages`
          const allMessages = CacheService.get('message', messagesCacheKey) || []
          
          console.log(`📖 [CACHE] Checking ${allMessages.length} cached messages for remaining unseen messages`)
          
          // Check if there are any remaining unseen messages from the other user
          const unseenMessages = allMessages.filter(msg => 
            msg.receiver_id === this.currentUserId && 
            msg.sender_id === otherUserId && 
            !msg.seen &&
            msg.id !== updatedMessage.id // Exclude the message we just marked as seen
          )
          
          console.log(`📖 [CACHE] Found ${unseenMessages.length} remaining unseen messages:`, 
                     unseenMessages.map(m => m.id))
          
          if (unseenMessages.length === 0) {
            conversation.has_new_message = false
            console.log('📖 [CACHE] No more unseen messages - removed new message indicator')
          } else {
            console.log('📖 [CACHE] Still has unseen messages - keeping new message indicator')
          }
        }
        
        conversations[conversationIndex] = conversation
        
        // Update both cache keys
        CacheService.setWithPersist('conversation', userCacheKey, conversations)
        CacheService.set('conversation', 'all', conversations) // Keep legacy for compatibility
        
        console.log('📦 Updated conversation cache for message seen status:', updatedMessage.id)
        
        // Emit event to notify UI
        this.emit('conversationListUpdated', {
          type: 'message_seen_status_update',
          messageId: updatedMessage.id,
          conversationUserId: updatedMessage.sender_id === this.currentUserId 
            ? updatedMessage.receiver_id 
            : updatedMessage.sender_id,
          timestamp: new Date().toISOString()
        })
      } else {
        console.warn('📖 [CACHE] Could not find conversation for message seen status update:', updatedMessage.id)

        // Fallback: try to find the conversation by fetching the current conversations list
        try {
          if (__DEV__) console.log('🔎 [CACHE FALLBACK] Attempting to locate conversation via apiManager.getConversations')
          const convs = await apiManager.getConversations(this.currentUserId)
          const otherUserId = updatedMessage.sender_id === this.currentUserId 
            ? updatedMessage.receiver_id 
            : updatedMessage.sender_id

          const idx = (convs || []).findIndex(c => {
            const convOther = c.sender_id === this.currentUserId ? c.receiver_id : c.sender_id
            return convOther === otherUserId || c.id === otherUserId || c.contact_id === otherUserId || (c.otherUser && c.otherUser.id === otherUserId)
          })

          if (idx >= 0) {
            const conv = convs[idx]
            // If this message is the last message for that conversation, update seen markers
            if (conv.last_message && conv.last_message.id === updatedMessage.id) {
              conv.last_message = { ...conv.last_message, seen: !!updatedMessage.seen, seen_at: updatedMessage.read_at || updatedMessage.seen_at || null }
              conv.last_message_id = updatedMessage.id
              // Write back to unified cache
              this.updateAllConversationCaches(this.currentUserId, convs, true)
              if (__DEV__) console.log('✅ [CACHE FALLBACK] Upserted seen status into conversation from fetched list')
              return
            }
          }
        } catch (err) {
          console.error('❌ [CACHE FALLBACK] Error while attempting fallback conversation lookup:', err)
        }

        // If we still couldn't locate the conversation, invalidate the conversations cache so UI can refetch
        try {
          if (__DEV__) console.log('⚠️ [CACHE FALLBACK] Invalidating conversations cache to allow refetch')
          apiManager.invalidateCache(apiManager.getCacheKey('conversations', { userId: this.currentUserId }))
        } catch (e) {
          console.error('❌ [CACHE FALLBACK] Failed to invalidate conversations cache:', e)
        }
      }
      
    } catch (error) {
      console.error('❌ Error updating message in conversation cache:', error)
    }
  }

  // Add new message to cache when user sends a message (OPTIMIZED)
  async addSentMessageToCache(message, otherUserId) {
    try {
      console.log('📦 [SENT MESSAGE] Adding sent message to cache:', message.id)
      
      // OPTIMIZATION: Batch cache updates to reduce operations
      const cacheUpdates = []
      
      // Handle media for sent messages - cache signed URL and preload
      if (message.media_url) {
        cacheUpdates.push(this.handleSentMessageMedia(message))
      }
      
      // Update conversation cache
      cacheUpdates.push(this.updateConversationCacheWithNewMessage(message))
      
      // Update message cache
      this.updateMessageCacheWithNewMessage(message, otherUserId)
      
      // OPTIMIZATION: Execute cache updates in parallel
      await Promise.all(cacheUpdates)
      
      // Emit events for UI updates (single emit instead of multiple)
      this.emit('messageSent', {
        message: message,
        otherUserId: otherUserId
      })
      
      console.log('✅ [SENT MESSAGE] Added sent message to cache successfully')
      
    } catch (error) {
      console.error('❌ Error adding sent message to cache:', error)
    }
  }

  // Add optimistic message to cache for immediate UI feedback
  addOptimisticMessage(optimisticMessage, otherUserId) {
    try {
      console.log('📦 [OPTIMISTIC] Adding optimistic message to cache:', optimisticMessage.id)
      
      // Update message cache immediately
      this.updateMessageCacheWithNewMessage(optimisticMessage, otherUserId)
      
      // Update conversation cache with optimistic message
      this.updateConversationCacheWithNewMessage(optimisticMessage)
      
      // Emit event for immediate UI update
      this.emit('optimisticMessageAdded', {
        message: optimisticMessage,
        otherUserId: otherUserId
      })
      
      console.log('✅ [OPTIMISTIC] Added optimistic message to cache')
      
    } catch (error) {
      console.error('❌ Error adding optimistic message to cache:', error)
    }
  }

  // Replace optimistic message with real sent message
  replaceOptimisticMessage(tempId, realMessage) {
    try {
      console.log('\ud83d\udd04 [OPTIMISTIC] Replacing optimistic message:', tempId, '->', realMessage.id)

      // Update caches in-place where possible instead of invalidating everything.
      const cacheKeys = apiManager.getCacheKeys()
      let replacedInAnyCache = false

      cacheKeys.forEach(key => {
        try {
          if (!key.includes('messages')) return

          const cachedData = apiManager.getFromCache(key)
          if (!cachedData || !Array.isArray(cachedData)) return

          // Find by temp id or temp field and replace
          const messageIndex = cachedData.findIndex(msg => (
            msg && (msg.id === tempId || msg._tempId === tempId || msg.tempId === tempId)
          ))
          if (messageIndex !== -1) {
            const updated = [...cachedData]
            updated[messageIndex] = realMessage
            // Merge & dedupe before persisting to avoid overwriting richer caches
            try {
              let base = apiManager.getFromCache(key)
              if (!Array.isArray(base)) base = cachedData.slice()
              base[messageIndex] = realMessage
              // dedupe prefer non-optimistic
              const seen = new Set()
              const dedupedReversed = []
              for (let i = base.length - 1; i >= 0; i--) {
                const m = base[i]
                if (!m) continue
                const ids = [m.id, m._tempId, m.tempId].filter(Boolean)
                const already = ids.some(id => seen.has(id))
                if (already) continue
                ids.forEach(id => seen.add(id))
                dedupedReversed.push(m)
              }
              const merged = dedupedReversed.reverse()
              apiManager.setCache(key, merged)
            } catch (err) {
              // fallback to naive set
              apiManager.setCache(key, updated)
            }
            console.log('\u2705 [OPTIMISTIC] Replaced optimistic message in cache:', key)
            replacedInAnyCache = true
            return
          }

          // Fallback: some keys include extra params (limit/order) so regex extraction may fail.
          // Use substring checks to detect conversation-specific caches containing sender/receiver.
          const sender = String(realMessage.sender_id)
          const receiver = String(realMessage.receiver_id)

          const isForConversation = (key.includes(`messages_currentUserId:${sender}`) && key.includes(`otherUserId:${receiver}`)) ||
                                    (key.includes(`messages_currentUserId:${receiver}`) && key.includes(`otherUserId:${sender}`))

          if (isForConversation) {
            // Remove any optimistic entries that match tempId to avoid duplicates
            const filtered = cachedData.filter(msg => !(msg && (msg.id === tempId || msg._tempId === tempId || msg.tempId === tempId)))

            // Merge into authoritative cache, dedupe and persist
            try {
              let base = apiManager.getFromCache(key)
              if (!Array.isArray(base)) base = filtered.slice()
              // remove any tempId occurrences
              base = base.filter(m => !(m && (m.id === tempId || m._tempId === tempId || m.tempId === tempId)))
              // append real message if not present
              const already = base.some(msg => msg && (msg.id === realMessage.id || msg._tempId === realMessage._tempId))
              if (!already) base.push(realMessage)

              // dedupe prefer non-optimistic
              const seen = new Set()
              const dedupedReversed = []
              for (let i = base.length - 1; i >= 0; i--) {
                const m = base[i]
                if (!m) continue
                const ids = [m.id, m._tempId, m.tempId].filter(Boolean)
                const alreadyId = ids.some(id => seen.has(id))
                if (alreadyId) continue
                ids.forEach(id => seen.add(id))
                dedupedReversed.push(m)
              }
              const merged = dedupedReversed.reverse()
              apiManager.setCache(key, merged)
            } catch (err) {
              // graceful fallback
              const already = filtered.some(msg => msg && (msg.id === realMessage.id || msg._tempId === realMessage._tempId))
              if (!already) filtered.push(realMessage)
              apiManager.setCache(key, filtered)
            }
            console.log('\u2705 [OPTIMISTIC] Cleaned and updated conversation cache:', key)
            replacedInAnyCache = true
            return
          }
        } catch (err) {
          console.error('\u274c [OPTIMISTIC] Error updating cache key', key, err)
        }
      })

      if (replacedInAnyCache) {
        // Update conversation cache to reflect latest last_message info
        this.updateConversationCacheWithNewMessage(realMessage)
      } else {
        // As a last resort, try to update the exact conversation-specific cache keys
        try {
          const sender = String(realMessage.sender_id)
          const receiver = String(realMessage.receiver_id)
          const possibleKeys = apiManager.getCacheKeys().filter(k => k.includes('messages') && (
            (k.includes(`messages_currentUserId:${sender}`) && k.includes(`otherUserId:${receiver}`)) ||
            (k.includes(`messages_currentUserId:${receiver}`) && k.includes(`otherUserId:${sender}`))
          ))

          possibleKeys.forEach(key => {
            try {
              const cached = apiManager.getFromCache(key) || []
              const cleaned = cached.filter(msg => !(msg && (msg.id === tempId || msg._tempId === tempId || msg.tempId === tempId)))
              try {
                let base = apiManager.getFromCache(key)
                if (!Array.isArray(base)) base = cleaned.slice()
                base = base.filter(m => !(m && (m.id === tempId || m._tempId === tempId || m.tempId === tempId)))
                const already = base.some(m => m && (m.id === realMessage.id || m._tempId === realMessage._tempId))
                if (!already) base.push(realMessage)

                // dedupe prefer non-optimistic
                const seen = new Set()
                const dedupedReversed = []
                for (let i = base.length - 1; i >= 0; i--) {
                  const m = base[i]
                  if (!m) continue
                  const ids = [m.id, m._tempId, m.tempId].filter(Boolean)
                  const alreadyId = ids.some(id => seen.has(id))
                  if (alreadyId) continue
                  ids.forEach(id => seen.add(id))
                  dedupedReversed.push(m)
                }
                const merged = dedupedReversed.reverse()
                apiManager.setCache(key, merged)
              } catch (err) {
                const already = cleaned.some(m => m && (m.id === realMessage.id || m._tempId === realMessage._tempId))
                if (!already) cleaned.push(realMessage)
                apiManager.setCache(key, cleaned)
              }
              replacedInAnyCache = true
            } catch (err) {
              // ignore per-key errors
            }
          })

          if (replacedInAnyCache) {
            this.updateConversationCacheWithNewMessage(realMessage)
          }
        } catch (err) {
          // swallow
        }
      }

      // Emit replacement event to trigger UI refresh
      this.emit('optimisticMessageReplaced', { tempId, realMessage })
      console.log('\u2705 [OPTIMISTIC] Replaced optimistic message successfully')
    } catch (error) {
      console.error('\u274c Error replacing optimistic message:', error)
    }
  }

  // Remove optimistic message (for cancellation)
  removeOptimisticMessage(tempId) {
    try {
      console.log('🗑️ [OPTIMISTIC] Removing optimistic message:', tempId)
      
      // Remove from message caches
      const cacheKeys = apiManager.getCacheKeys()
      
      cacheKeys.forEach(key => {
        if (key.includes('messages')) {
          const cachedData = apiManager.getFromCache(key)
          if (cachedData && Array.isArray(cachedData)) {
            const filteredData = cachedData.filter(msg => msg.id !== tempId)
            if (filteredData.length !== cachedData.length) {
              apiManager.setCache(key, filteredData)
              console.log('🗑️ [OPTIMISTIC] Removed message from cache:', key)
            }
          }
        }
      })
      
      // Emit removal event
      this.emit('optimisticMessageRemoved', {
        tempId
      })
      
      console.log('✅ [OPTIMISTIC] Removed optimistic message successfully')
      
    } catch (error) {
      console.error('❌ Error removing optimistic message:', error)
    }
  }

  // Handle media for sent messages - OPTIMIZED to prevent duplicate signing
  async handleSentMessageMedia(message) {
    try {
      console.log('📤 [SENT MEDIA] Processing sent message media:', message.media_url)
      
      // EGRESS OPTIMIZATION: Skip signing for sent messages during upload flow
      // The upload process already handles URL signing, and the media isn't viewed immediately
      // This prevents duplicate storage signing requests in the API logs
      console.log('🚀 [EGRESS_OPT] Skipping redundant signing for sent message - upload process handles this')
      
      // Only preload if we already have a cached signed URL from the upload process
      if (CacheService.has('signedUrl', message.media_url)) {
        console.log('✅ [SENT MEDIA] Using cached signed URL from upload process')
        this.preloadMessageMedia(message)
      } else {
        console.log('⚠️ [SENT MEDIA] No cached URL from upload - skipping preload to avoid redundant signing')
      }
    } catch (error) {
      console.error('❌ [SENT MEDIA] Error handling sent message media:', error)
    }
  }

  // Helper to get conversation ID from message
  getConversationId(message) {
    return message.sender_id === this.currentUserId ? message.receiver_id : message.sender_id
  }
  
  // P3 FIX: Disabled direct user fetching - use optimized conversation refresh instead
  async fetchUserInfoSync(userId) {
    console.log('⚠️ [P3_FIX] Skipping direct user fetch for:', userId)
    console.log('� [P3_FIX] User info now comes from get_conversations RPC - triggering conversation refresh instead')
    
    // Return placeholder immediately and trigger conversation refresh
    const shortId = userId.substring(0, 6)
    const placeholder = {
      id: userId,
      pseudo: `User #${shortId}`
    }
    
    // Trigger conversation refresh to get proper user info through RPC
    setTimeout(() => {
      this.emit('refresh_conversations')
    }, 100)
    
    return placeholder
  }

  // P3 FIX: Disabled direct user fetching - use optimized conversation refresh instead  
  async fetchUserInfoAsync(userId) {
    console.log('⚠️ [P3_FIX] Skipping async user fetch for:', userId)
    console.log('📋 [P3_FIX] User info now comes from get_conversations RPC - no individual /users calls needed')
    
    // Don't make any API calls - the conversation refresh will handle this
    return Promise.resolve()
  }
  
  // Update placeholder user info with better formatting
  updatePlaceholderUserInfo(userId) {
    try {
      const userCacheKey = `conversations_${this.currentUserId}`
      const conversations = CacheService.get('conversation', userCacheKey) || CacheService.get('conversation', 'all') || []
      const conversationIndex = conversations.findIndex(conv => 
        (conv.contact_id === userId || conv.id === userId) ||
        (conv.otherUser && conv.otherUser.id === userId)
      )
      
      if (conversationIndex >= 0) {
        // Generate a better placeholder name
        const shortId = userId.substring(0, 6)
        const betterPseudo = `User #${shortId}` // More user-friendly format
        
        conversations[conversationIndex].otherUser = {
          id: userId,
          pseudo: betterPseudo
        }
        
        // Update both cache keys
        const userCacheKey = `conversations_${this.currentUserId}`
        CacheService.setWithPersist('conversation', userCacheKey, conversations)
        CacheService.set('conversation', 'all', conversations) // Keep legacy for compatibility
        console.log('📦 Updated conversation with better placeholder:', betterPseudo)
        
        // Notify UI that conversation data has been updated
        this.emit('userInfoUpdated', {
          userId: userId,
          pseudo: betterPseudo
        })
      }
    } catch (error) {
      console.error('❌ Error updating placeholder user info:', error)
    }
  }

  // Validate and fix conversation data if needed
  validateAndFixConversationData(conversations) {
    if (!Array.isArray(conversations)) {
      console.error('❌ Invalid conversations data: not an array')
      return false
    }

    let hasChanges = false

    for (let i = 0; i < conversations.length; i++) {
      const conv = conversations[i]
      if (!conv) {
        console.warn(`⚠️ Found null conversation at index ${i}, removing it`)
        conversations.splice(i, 1)
        i--
        hasChanges = true
        continue
      }

      // Fix missing ID fields
      if (!conv.id && conv.contact_id) {
        console.log('🔧 Fixing missing ID in conversation:', i)
        conv.id = conv.contact_id
        hasChanges = true
      }

      // Fix missing contact_id fields
      if (!conv.contact_id && conv.id) {
        console.log('🔧 Fixing missing contact_id in conversation:', i)
        conv.contact_id = conv.id
        hasChanges = true
      }

      // Fix missing otherUser field
      if (!conv.otherUser && (conv.contact_id || conv.id)) {
        console.log('🔧 Adding placeholder otherUser to conversation:', i)
        const userId = conv.contact_id || conv.id
        const shortId = userId.substring(0, 6)
        conv.otherUser = {
          id: userId,
          pseudo: `User #${shortId}`
        }
        hasChanges = true
        // Schedule async fetch of real user data if needed
        this.fetchUserInfoAsync(userId).catch(err => console.error('Error fetching user info for fixed conversation:', err))
      }
    }

    return hasChanges
  }
  
  // Remove duplicate conversations based on ID to prevent duplicates
  removeDuplicateConversations(conversations) {
    if (!Array.isArray(conversations)) {
      return []
    }
    
    const seen = new Set()
    return conversations.filter(conv => {
      if (!conv) return false
      
      // Get a unique identifier for the conversation
      const convId = conv.id || conv.contact_id || 
                    (conv.otherUser ? conv.otherUser.id : null) ||
                    (conv.sender_id === this.currentUserId ? conv.receiver_id : conv.sender_id)
                    
      if (!convId) return false
      
      // If we've seen this ID before, it's a duplicate
      if (seen.has(convId)) {
        return false
      }
      
      seen.add(convId)
      return true
    })
  }

  // Cleanup all subscriptions
  cleanup() {
    console.log('🧹 Cleaning up real-time cache manager')
    
    // Cleanup production realtime service callbacks
    try {
      const unregister = this.subscriptions.get('all_conversations')?.unsubscribe
      if (typeof unregister === 'function') {
        unregister()
        console.log('📡 Unregistered production realtime callback')
      }
    } catch (error) {
      console.error('❌ Error unregistering production realtime callback:', error)
    }
    
    // Clean up legacy subscriptions
    this.subscriptions.forEach((subscription, key) => {
      try {
        // Safety check for undefined subscription or missing unsubscribe function
        if (subscription && typeof subscription.unsubscribe === 'function') {
          subscription.unsubscribe()
          console.log('📡 Unsubscribed from', key)
        } else {
          console.warn(`⚠️ Unable to unsubscribe: Invalid subscription object for ${key}`)
        }
      } catch (error) {
        console.error(`❌ Error unsubscribing from ${key}:`, error)
      }
    })
    
    this.subscriptions.clear()
    
    // Clean up all event listeners
    this.removeAllListeners()
    
    this.isInitialized = false
    this.currentUserId = null
  }

  // Complete cleanup for account deletion
  async cleanupForAccountDeletion() {
    console.log('🗑️ Starting complete cleanup for account deletion...')
    
    // 1. Clean up all subscriptions
    this.cleanup()
    
    // 2. Clear all local caches
    try {
      const { default: CacheService } = await import('./cacheService')
      CacheService.clear('all')
      console.log('✅ Cleared all local caches for account deletion')
    } catch (error) {
      console.error('❌ Error clearing caches during account deletion:', error)
    }
    
    console.log('✅ Complete cleanup for account deletion finished')
  }

  // Get current subscription status
  getSubscriptionStatus() {
    return {
      isInitialized: this.isInitialized,
      currentUserId: this.currentUserId,
      subscriptions: Array.from(this.subscriptions.keys())
    }
  }

  /**
   * Update user info in existing conversations without triggering full reload
   */
  async updateUserInfoInConversations(userId, userData, conversationOwnerId) {
    try {
      const userCacheKey = `conversations_${conversationOwnerId}`
      let conversations = CacheService.get('conversation', userCacheKey) || []
      
      if (conversations.length === 0) return // No conversations to update
      
      let updated = false
      conversations.forEach((conv, index) => {
        if (conv.otherUser && conv.otherUser.id === userId && conv.otherUser.pseudo.startsWith('User #')) {
          conversations[index] = {
            ...conv,
            otherUser: userData
          }
          updated = true
        }
      })
      
      if (updated) {
        // Update cache
        CacheService.setWithPersist('conversation', userCacheKey, conversations)
        
        // Emit event to update UI without full reload
        this.emit('userInfoUpdated', {
          userId,
          userData,
          source: 'apiManager_async'
        })
        
        if (__DEV__) {
          console.log(`✅ [CACHE MANAGER] Updated user info for ${userData.pseudo} in conversations`)
        }
      }
    } catch (error) {
      console.error('❌ [CACHE MANAGER] Error updating user info in conversations:', error)
    }
  }
}

// Create singleton instance
export const realtimeCacheManager = new OptimizedRealtimeCacheManager()

let appStateSubscription = null

export const initializeRealtimeCacheManager = () => {
  if (appStateSubscription) {
    appStateSubscription.remove()
  }

  appStateSubscription = AppState.addEventListener('change', async (nextAppState) => {
    try {
      if (nextAppState === 'active') {
        // App became active - reinitialize if needed
        const currentUser = await getCurrentUser()
        if (currentUser) {
          await realtimeCacheManager.initialize(currentUser.id)
        }
      } else if (nextAppState === 'background') {
        // App went to background - keep subscriptions active for notifications
        // Don't cleanup subscriptions to continue receiving updates
      }
    } catch (error) {
      console.error('Error handling app state change in realtime cache manager:', error)
    }
  })
}

export const cleanupRealtimeCacheManager = () => {
  if (appStateSubscription) {
    appStateSubscription.remove()
    appStateSubscription = null
  }
  realtimeCacheManager.cleanup()
}
