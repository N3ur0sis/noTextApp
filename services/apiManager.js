/**
 * Centralized API Manager
 * Controls all API calls, implements caching, batching, and deduplication
 * Ensures optimal performance with minimal database queries
 */

import { getUserData } from '../utils/secureStore'
import { supabase } from './supabaseClient'

class APIManager {
  constructor() {
    this.cache = new Map()
    this.pendingRequests = new Map()
    this.lastFetchTimes = new Map()
    this.persistentKeys = new Set() // Track which keys should persist across app restarts
    this._persistTimeout = null // P6 FIX: Debounced persistence timeout
    
    // Cache TTL settings (in milliseconds)
    this.cacheTTL = {
      conversations: 5 * 60 * 1000,    // 5 minutes
      messages: 10 * 60 * 1000,        // 10 minutes  
      user: 30 * 60 * 1000,            // 30 minutes
      userSearch: 2 * 60 * 1000,       // 2 minutes
      media: 24 * 60 * 60 * 1000       // 24 hours for media URLs
    }
    
    // Initialize cache restoration
    this._restoreCacheFromStorage()
  }

  /**
   * Invalidate memory cache entries matching a RegExp pattern (keys are strings)
   * pattern may be a RegExp or a string (will be converted to RegExp)
   */
  invalidate(pattern) {
    try {
      const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
      // BUGFIX: use the actual cache map (this.cache), not a non-existent memoryCache
      const keys = Array.from(this.cache.keys ? this.cache.keys() : []);
      keys.forEach(k => {
        try {
          if (re.test(k)) {
            this.cache.delete(k)
            if (__DEV__) console.log(`🗑️ [API MANAGER] Invalidated cache key: ${k}`)
          }
        } catch (e) {}
      })
    } catch (e) {
      if (__DEV__) console.warn('⚠️ [API MANAGER] invalidate failed', e)
    }
  }

  // Generate cache key
  getCacheKey(type, params = {}) {
    const paramStr = Object.keys(params)
      .sort()
      .map(key => `${key}:${params[key]}`)
      .join('|')
    return `${type}_${paramStr}`
  }

  // Check if cached data is fresh
  isCacheFresh(key, ttl) {
    const cached = this.cache.get(key)
    if (!cached) return false
    return (Date.now() - cached.timestamp) < ttl
  }

  // Get from cache or fetch fresh
  async getOrFetch(key, fetcher, ttl) {
    // Return cached data if fresh
    if (this.isCacheFresh(key, ttl)) {
      if (__DEV__) console.log(`📦 [API MANAGER] Cache hit: ${key}`)
      return this.cache.get(key).data
    }

    // Deduplicate concurrent requests
    if (this.pendingRequests.has(key)) {
      if (__DEV__) console.log(`⏳ [API MANAGER] Waiting for pending request: ${key}`)
      return await this.pendingRequests.get(key)
    }

    // Fetch fresh data
    if (__DEV__) console.log(`🌐 [API MANAGER] Fetching: ${key}`)
    const promise = fetcher()
    this.pendingRequests.set(key, promise)

    try {
      const data = await promise
      
      // Cache the result
      this.cache.set(key, {
        data,
        timestamp: Date.now()
      })
      
      // Mark conversations and messages as persistent
      if (key.startsWith('conversations_') || key.startsWith('messages_')) {
        this.markAsPersistent(key)
        // Schedule persistence
        setTimeout(() => this._persistCacheToStorage(), 100)
      }
      
      if (__DEV__) console.log(`✅ [API MANAGER] Cached: ${key}`)
      return data
    } finally {
      this.pendingRequests.delete(key)
    }
  }

  // Clear specific cache entry
  clearCache(key) {
    this.cache.delete(key)
    if (__DEV__) console.log(`🗑️ [API MANAGER] Cleared cache: ${key}`)
  }

  // Clear all cache entries matching pattern
  clearCachePattern(pattern) {
    const regex = new RegExp(pattern)
    let cleared = 0
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key)
        cleared++
      }
    }
        if (__DEV__) console.log(`🗑️ [API MANAGER] Cleared ${cleared} cache entries matching: ${pattern}`)
  }
  
  // Clear all cache entries
  clearAllCache() {
    const count = this.cache.size
    this.cache.clear()
    this.pendingRequests.clear()
    this.lastFetchTimes.clear()
    if (__DEV__) console.log(`🗑️ [API MANAGER] Cleared all ${count} cache entries`)
  }

  // Get all cache keys (for external access)
  getCacheKeys() {
    return Array.from(this.cache.keys())
  }

  // Get cached data by key (for external access)
  getFromCache(key) {
    const cached = this.cache.get(key)
    return cached ? cached.data : null
  }

  // Set cache data directly (for external access)
  setCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    })
    
    // P6 FIX: Auto-persist conversations and messages cache
    if (key.startsWith('conversations_') || key.startsWith('messages_')) {
      this.markAsPersistent(key)
      // Debounced persistence to avoid excessive writes
      if (this._persistTimeout) clearTimeout(this._persistTimeout)
      this._persistTimeout = setTimeout(() => this._persistCacheToStorage(), 200)
    }
    // DEV HELPERS: Log message cache sizes when setting cache to help diagnose
    try {
      if (__DEV__ && key.startsWith('messages_')) {
        const len = Array.isArray(data) ? data.length : (data && data.data && Array.isArray(data.data) ? data.data.length : 'unknown')
        console.log(`🧾 [API MANAGER DEBUG] setCache for ${key} — messages length: ${len}`)
      }
    } catch (e) {
      // ignore logging failures
    }
    
    if (__DEV__) console.log(`💾 [API MANAGER] Set cache: ${key}`)
  }

  // Invalidate specific cache entry and related caches
  invalidateCache(key) {
    this.cache.delete(key)
    if (__DEV__) console.log(`🗑️ [API MANAGER] Invalidated cache: ${key}`)
  }

  // Update existing cache with new data
  updateCache(key, data) {
    this.setCache(key, data)
  }
  
  // Invalidate all caches for a user (conversations and messages)
  invalidateUserCaches(userId) {
    const conversationKey = this.getCacheKey('conversations', { userId })
    this.invalidateCache(conversationKey)
    
    // Also invalidate any message caches for this user
    for (const [key] of this.cache) {
      if (key.includes('messages') && key.includes(userId)) {
        this.invalidateCache(key)
      }
    }
    if (__DEV__) console.log(`🗑️ [API MANAGER] Invalidated all caches for user: ${userId}`)
  }

  // =============================================================================
  // API METHODS - All app API calls go through these methods
  // =============================================================================

  /**
   * Get conversations with intelligent caching
   * This is the PRIMARY conversation fetching method
   */
  async getConversations(userId) {
    if (!userId) return []
    
    const key = this.getCacheKey('conversations', { userId })
    
    return await this.getOrFetch(key, async () => {
      console.log(`🔍 [API MANAGER] Fetching conversations for user: ${userId}`)
      
      // PATCH 1: Use efficient RPC instead of heavy messages scan
      const { data, error } = await supabase
        .rpc('get_conversations', { _user: userId })
        .range(0, 9) // EGRESS OPTIMIZATION: Show only top 10 conversations (90%+ users only need 5-10)

      if (error) throw error

      // Import NSFW service for filtering
      const { nsfwViewService } = await import('./nsfwViewService')

      // Sync NSFW service with database state before filtering
      await nsfwViewService.syncWithDatabase(data || [])

      // Convert RPC results to conversation format with enriched user data
      const conversations = await Promise.all((data || []).map(async row => {
        // Create proper last_message structure
        const lastMessage = {
          id: row.last_message_id,
          created_at: row.last_created_at,
          sender_id: row.last_sender_id,
          receiver_id: row.last_receiver_id,
          media_type: row.last_media_type,
          media_url: row.last_media_url,
          thumbnail_url: row.last_thumbnail_url,
          is_nsfw: row.last_is_nsfw,
          view_once: row.last_view_once,
          caption: row.last_caption
        }

        // P3 FIX: Use peer_pseudo from RPC result to avoid separate /users calls
        const otherUser = {
          id: row.peer_id,
          pseudo: row.peer_pseudo || `User #${row.peer_id.substring(0, 6)}` // Fallback if pseudo is null
        }
        
        // P3 FIX: No more user fetching needed - pseudo comes from RPC

        const conversation = {
          // Use stable peer_id as the conversation identifier so realtime can find it
          id: row.peer_id,
          peer_id: row.peer_id,
          contact_id: row.peer_id, // Add contact_id for compatibility
          sender_id: row.last_sender_id, // Add sender_id for read indicators
          receiver_id: row.last_receiver_id, // Add receiver_id for read indicators
          last_message: lastMessage,
          last_message_id: row.last_message_id,
          last_message_time: row.last_created_at, // Add for time formatting
          created_at: row.last_created_at, // Add created_at for time display
          is_nsfw: row.last_is_nsfw,
          seen: row.unread_count === 0,
          last_seen: row.last_seen, // Add last_seen from RPC
          last_seen_at: row.last_seen_at, // Add last_seen_at from RPC
          otherUser,
          media_url: row.last_media_url, // Add media_url for compatibility
          media_type: row.last_media_type, // Add media_type for type indicators
          thumbnail_url: row.last_thumbnail_url, // Add thumbnail_url for thumbnails
          latestMediaType: row.last_media_type,
          latestMediaUrl: row.last_media_url,
          latestThumbnailUrl: row.last_thumbnail_url,
          has_new_message: row.unread_count > 0,
          unread_count: row.unread_count,
          view_once: row.last_view_once || false, // Use actual value from RPC
          caption: row.last_caption // Use actual caption from RPC
        }

        return conversation
      }))

  const validConversations = conversations.filter(Boolean) // Remove null entries

  // Normalize read state for conversations to avoid RPC noisy seen:true
  const normalizedConversations = (validConversations || []).map(c => this.normalizeConversationReadState(c, userId));

      console.log(`✅ [API MANAGER] Fetched ${data?.length || 0} conversations via RPC`)
      
      if (__DEV__ && validConversations.length > 0) {
        console.log('🔍 [API MANAGER] Sample conversation structure:', JSON.stringify(validConversations[0], null, 2))
      }
      
      return normalizedConversations
    }, this.cacheTTL.conversations)
  }

  /**
   * Normalize conversation read state: ensure sender_id/receiver_id exist and
   * default seen=false for messages that were sent by the current user unless
   * there is explicit proof of read (read_at/read_by/seen_at flags).
   */
  normalizeConversationReadState(conv, userId) {
    if (!conv || !userId) return conv || {};
    const c = { ...conv };
    const lastMsg = c.last_message || {};
    const senderId = c.sender_id ?? lastMsg.sender_id ?? null;
    const receiverId = c.receiver_id ?? lastMsg.receiver_id ?? null;
    const lastMessageId = c.last_message_id ?? lastMsg.id ?? null;

    const fromMe = senderId === userId;
    const lastSeenFlag = (c.last_seen === true) || Boolean(c.last_seen_at);
    const explicitRead = Boolean(
      c.read_at || c.seen_at || c.read_by ||
      lastMsg.read_at || lastMsg.seen_at || lastMsg.read || lastMsg.seen
    );

    // Derive directional read flags when available from RPC
    const seen_by_other = fromMe ? lastSeenFlag : (typeof c.seen_by_other === 'boolean' ? c.seen_by_other : false);
    const seen_by_me = !fromMe ? lastSeenFlag : (typeof c.seen_by_me === 'boolean' ? c.seen_by_me : false);

    return {
      ...c,
      sender_id: senderId,
      receiver_id: receiverId,
      last_message_id: lastMessageId,
      // If the last message is from me, consider explicit flags OR RPC-provided last_seen
      seen: fromMe ? ((explicitRead || lastSeenFlag) ? true : false) : false,
      seen_by_other,
      seen_by_me
    }
  }

  /**
   * Schedule async user info fetch to avoid blocking conversation loading
   */
  async _scheduleUserInfoFetch(userId, conversationOwnerId) {
    // Use a short delay to batch multiple requests
    setTimeout(async () => {
      try {
        const userData = await this.findUserByUserId(userId)
        if (userData) {
          // Update conversation cache with real user info
          const { realtimeCacheManager } = await import('./realtimeCacheManager')
          await realtimeCacheManager.updateUserInfoInConversations(userId, userData, conversationOwnerId)
        }
      } catch (error) {
        // Silently fail - placeholder will remain
        console.log(`⚠️ [API MANAGER] Background user fetch failed for ${userId}:`, error.message)
      }
    }, 100) // Small delay to batch requests
  }

  /**
   * Force refresh conversations (bypass cache)
   */
  async refreshConversations(userId) {
    if (!userId) return []
    
    const key = this.getCacheKey('conversations', { userId })
    // Clear cache first to force fresh fetch
    this.invalidateCache(key)
    
    console.log(`🔄 [API MANAGER] Force refreshing conversations for user: ${userId}`)
    return await this.getConversations(userId)
  }

  /**
   * Get messages between two users with intelligent caching
   */
  async getMessages(currentUserId, otherUserId, options = {}) {
    if (!currentUserId || !otherUserId) return []
    
    const DEFAULT_LIMIT = 30
    const { 
      before,
      after,
      limit = DEFAULT_LIMIT, 
      offset = 0, 
      orderBy = 'created_at', 
      orderDirection = 'asc' 
    } = options;
    
    // Include options in cache key for different query results
    const key = this.getCacheKey('messages', { 
      currentUserId, 
      otherUserId, 
      before,
      after,
      limit, 
      offset, 
      orderBy, 
      orderDirection 
    })
    
    return await this.getOrFetch(key, async () => {
      console.log(`🔍 [API MANAGER] Fetching messages: ${currentUserId} <-> ${otherUserId}`, options)
      
      let query = supabase
        .from('messages')
        // Select essential fields plus read indicators used by UI - FIXED: Added caption field (removed content as it doesn't exist)
        .select('id,created_at,sender_id,receiver_id,media_type,media_url,thumbnail_url,caption,view_once,seen,seen_at,is_nsfw,viewed_at,is_muted')
        .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${currentUserId})`)
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .limit(limit)

      // Apply cursor-based pagination
      if (before) {
        query = query.lt('created_at', before)
      }
      if (after) {
        query = query.gt('created_at', after)
      }

      // Apply offset if specified (for backward compatibility)
      if (offset > 0) {
        query = query.range(offset, offset + limit - 1)
      }

      const { data, error } = await query

      if (error) throw error

      // Import NSFW service for filtering
      const { nsfwViewService } = await import('./nsfwViewService')

      // Sync NSFW service with database state before filtering
      await nsfwViewService.syncWithDatabase(data || [])

      // Filter out viewed NSFW messages (after viewing/timer), regardless of view_once
      const filteredData = (data || []).filter(message => {
        // Keep all non-NSFW messages
        if (!message.is_nsfw) return true

        const isViewedByService = nsfwViewService.isViewed(message.id)
        if (isViewedByService) {
          if (__DEV__) console.log(`🔥 [API_MANAGER] Filtering out viewed NSFW message: ${message.id}`)
          return false
        }

        return true
      })

      console.log(`✅ [API MANAGER] Fetched ${data?.length || 0} messages, filtered to ${filteredData.length}`)

      // Also populate the pair-level cache key used by realtime + chat hook for instant reads
      try {
        const pairKey = this.getCacheKey('messages', { currentUserId, otherUserId })
        // Keep same order as returned here; chat sorts as needed
        this.setCache(pairKey, filteredData)
      } catch (e) {
        if (__DEV__) console.warn('⚠️ [API MANAGER] Failed to set pair-level messages cache:', e)
      }

      return filteredData
    }, this.cacheTTL.messages)
  }

  /**
   * Force refresh messages (bypass cache)
   */
  async refreshMessages(currentUserId, otherUserId, options = {}) {
    if (!currentUserId || !otherUserId) return []
    
    const DEFAULT_LIMIT = 30
    const { 
      before,
      after,
      limit = DEFAULT_LIMIT, 
      offset = 0, 
      orderBy = 'created_at', 
      orderDirection = 'asc' 
    } = options;
    
    // Include options in cache key for different query results
    const key = this.getCacheKey('messages', { 
      currentUserId, 
      otherUserId, 
      before,
      after,
      limit, 
      offset, 
      orderBy, 
      orderDirection 
    })
    // Clear cache first to force fresh fetch
    this.invalidateCache(key)
    
    console.log(`🔄 [API MANAGER] Force refreshing messages: ${currentUserId} <-> ${otherUserId}`, options)
    return await this.getMessages(currentUserId, otherUserId, options)
  }

  /**
   * Get cached messages immediately without waiting for network
   * Returns null if no cache available
   */
  getCachedMessages(currentUserId, otherUserId) {
    if (!currentUserId || !otherUserId) return null
    
    const key = this.getCacheKey('messages', { currentUserId, otherUserId })
    
    if (this.isCacheFresh(key, this.cacheTTL.messages)) {
      if (__DEV__) console.log(`⚡ [API MANAGER] Instant cache hit: ${key}`)
      return this.cache.get(key).data
    }
    
    return null
  }

  /**
   * Get current user with caching
   */
  async getCurrentUser() {
    const key = this.getCacheKey('user', { type: 'current' })
    
    return await this.getOrFetch(key, async () => {
      console.log(`🔍 [API MANAGER] Fetching current user directly`)
      
      // Get user data from secure storage to avoid circular dependency
      const userData = await getUserData()
      if (!userData?.id) return null
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userData.id)
        .single()
      
      if (error) {
        console.error('❌ [API MANAGER] Error fetching current user:', error)
        return null
      }
      
      console.log(`✅ [API MANAGER] Fetched current user: ${data.pseudo}`)
      return data
    }, this.cacheTTL.user)
  }

  /**
   * Search users with caching
   */
  async searchUsers(searchTerm) {
    if (!searchTerm || searchTerm.trim().length < 2) return []
    
    const key = this.getCacheKey('userSearch', { pseudo: searchTerm.toLowerCase() })
    
    return await this.getOrFetch(key, async () => {
      console.log(`🔍 [API MANAGER] Searching users: ${searchTerm}`)
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .ilike('pseudo', `${searchTerm}%`)
        .limit(10)

      if (error) throw error
      
      console.log(`✅ [API MANAGER] Found ${data.length} users`)
      return data || []
    }, this.cacheTTL.userSearch)
  }

  /**
   * Mark message as read
   * P7 FIX: Use minimal return and filter for efficiency
   */
  async markMessageAsRead(messageId, currentUserId) {
    if (!messageId || !currentUserId) return null
    
    try {
      console.log(`🔍 [API MANAGER] Marking message as read: ${messageId}`)
      
      // P7 FIX: Filter by seen=false to avoid unnecessary updates + minimal return
      const { error } = await supabase
        .from('messages')
        .update({ seen: true })
        .eq('id', messageId)
        .eq('receiver_id', currentUserId) // Only receiver can mark as read
        .eq('seen', false) // P7 FIX: Only update unread messages
        // P7 FIX: Use minimal return instead of select().single()

      if (error) throw error

      // Update in-memory message caches in-place: set seen=true for the message
      try {
        const nowIso = new Date().toISOString()
        for (const key of this.getCacheKeys()) {
          if (typeof key !== 'string' || !key.startsWith('messages_')) continue
          try {
            const cached = this.getFromCache(key) || []
            if (Array.isArray(cached) && cached.length > 0) {
              let changed = false
              const updated = cached.map(m => {
                if (m && m.id === messageId && !m.seen) {
                  changed = true
                  return { ...m, seen: true, seen_at: nowIso }
                }
                return m
              })
              if (changed) this.setCache(key, updated)
            }
          } catch (e) {
            // ignore per-key errors
          }
        }
      } catch (e) {
        if (__DEV__) console.warn('⚠️ [API MANAGER] Failed to update caches for read message', e)
      }

      // Emit realtime events for UI updates
      try {
        const { realtimeCacheManager } = await import('./realtimeCacheManager')
        const eventPayload = {
          messageId,
          receiverId: currentUserId,
          seenAt: new Date().toISOString(),
          by: currentUserId
        }
        realtimeCacheManager.emit('messageRead', eventPayload)
        realtimeCacheManager.emit('messageReadStatusUpdated', eventPayload)
        realtimeCacheManager.emit('conversationUpdate', {
          type: 'single_message_read',
          messageId,
          receiverId: currentUserId,
          timestamp: new Date().toISOString(),
        })
      } catch (e) {
        if (__DEV__) console.warn('⚠️ [API MANAGER] Failed to emit read event', e)
      }

      console.log(`✅ [API MANAGER] Marked message as read: ${messageId}`)
      return { id: messageId } // Return minimal data
    } catch (err) {
      console.error('❌ [API MANAGER] Error marking message as read:', err)
      return null
    }
  }

  // =============================================================================
  // CACHE INVALIDATION - Called when real-time updates occur
  // =============================================================================

  /**
   * Invalidate caches when new message is received
   */
  onNewMessage(message) {
    const senderId = message.sender_id
    const receiverId = message.receiver_id
    
    // Clear conversation caches for both users
    this.clearCache(this.getCacheKey('conversations', { userId: senderId }))
    this.clearCache(this.getCacheKey('conversations', { userId: receiverId }))
    
    // Clear message cache for this conversation
    this.clearCache(this.getCacheKey('messages', { currentUserId: senderId, otherUserId: receiverId }))
    this.clearCache(this.getCacheKey('messages', { currentUserId: receiverId, otherUserId: senderId }))
    
    console.log(`🔄 [API MANAGER] Invalidated caches for new message: ${message.id}`)
  }

  /**
   * Invalidate caches when message is read
   */
  onMessageRead(messageId, senderId, receiverId) {
    // Clear conversation caches (read status affects conversation list)
    this.clearCache(this.getCacheKey('conversations', { userId: senderId }))
    this.clearCache(this.getCacheKey('conversations', { userId: receiverId }))
    
    // Also clear message caches to ensure read status is synchronized
    this.clearCache(this.getCacheKey('messages', { currentUserId: senderId, otherUserId: receiverId }))
    this.clearCache(this.getCacheKey('messages', { currentUserId: receiverId, otherUserId: senderId }))
    
    console.log(`🔄 [API MANAGER] Invalidated caches for message read: ${messageId}`)
  }



  /**
   * Mark a cache key as persistent across app restarts
   */
  markAsPersistent(key) {
    this.persistentKeys.add(key)
  }
  
  /**
   * Save the cache to AsyncStorage
   * Only persistent keys are stored
   */
  async _persistCacheToStorage() {
    try {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default
      
      const persistentCache = {}
      for (const key of this.persistentKeys) {
        // Skip persisting any malformed message cache keys created by older builds
        // e.g. keys like: messages_currentUserId:<id>|otherUserId:undefined
        if (typeof key === 'string' && key.startsWith('messages_') && key.includes('|otherUserId:undefined')) {
          if (__DEV__) console.log(`🧹 [API MANAGER] Skipping persist of invalid key: ${key}`)
          continue
        }
        if (this.cache.has(key)) {
          persistentCache[key] = this.cache.get(key)
        }
      }
      
      if (Object.keys(persistentCache).length > 0) {
        // DEV: Log sizes of message caches being persisted
        if (__DEV__) {
          Object.entries(persistentCache).forEach(([k, v]) => {
            if (k.startsWith('messages_')) {
              try {
                const len = Array.isArray(v.data) ? v.data.length : 'unknown'
                console.log(`💾 [API MANAGER DEBUG] Persisting ${k} with ${len} messages (timestamp: ${v.timestamp})`)
              } catch (e) {
                console.log(`💾 [API MANAGER DEBUG] Persisting ${k} (unable to determine length)`)
              }
            }
          })
        }

        await AsyncStorage.setItem('apiCache', JSON.stringify(persistentCache))
        console.log(`💾 [API MANAGER] Persisted ${Object.keys(persistentCache).length} cache entries`)
      }
    } catch (error) {
      console.error('Error persisting cache:', error)
    }
  }
  
  /**
   * Restore cache from AsyncStorage on app start
   */
  async _restoreCacheFromStorage() {
    try {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default
      
      const cachedData = await AsyncStorage.getItem('apiCache')
      if (cachedData) {
        const persistentCache = JSON.parse(cachedData)
        
        // Restore only valid entries (not expired)
        const now = Date.now()
        let restoredCount = 0
        
        for (const [key, value] of Object.entries(persistentCache)) {
          // Clean up malformed message cache keys from older builds
          if (typeof key === 'string' && key.startsWith('messages_') && key.includes('|otherUserId:undefined')) {
            if (__DEV__) console.log(`🧹 [API MANAGER] Dropping invalid persisted key: ${key}`)
            continue
          }
          const [type] = key.split('_')
          const ttl = this.cacheTTL[type] || 0
          // DEV: log attempted restore for message caches
          if (__DEV__ && key.startsWith('messages_')) {
            try {
              const len = Array.isArray(value.data) ? value.data.length : 'unknown'
              console.log(`📂 [API MANAGER DEBUG] Found persisted ${key} with ${len} messages (age: ${Math.round((now - value.timestamp)/1000)}s, ttl: ${ttl}s)`)
            } catch (e) {
              console.log(`📂 [API MANAGER DEBUG] Found persisted ${key} (unable to determine length)`)
            }
          }

          // Always restore persisted entries so the UI can show history immediately on startup.
          // Previously we dropped restores older than TTL which caused conversations to appear empty
          // after app restart even though a persisted copy existed. Keep the original timestamp so
          // freshness checks still behave correctly elsewhere.
          this.cache.set(key, value)
          this.persistentKeys.add(key)
          restoredCount++

          // Log whether this restored entry is stale relative to configured TTL
          if (__DEV__ && key.startsWith('messages_')) {
            try {
              const len = Array.isArray(value.data) ? value.data.length : 'unknown'
              const ageSec = Math.round((now - value.timestamp) / 1000)
              const ttlSec = Math.round((ttl || 0) / 1000)
              if (now - value.timestamp >= ttl) {
                console.log(`📂 [API MANAGER DEBUG] Restored ${key} (${len} messages) but it is STALE: age ${ageSec}s, ttl ${ttlSec}s`)
              } else {
                console.log(`📂 [API MANAGER DEBUG] Restored ${key} (${len} messages) from storage`)
              }
            } catch (e) {
              // ignore logging failures
            }
          }
        }
        
        console.log(`📂 [API MANAGER] Restored ${restoredCount} cache entries`)
      }
    } catch (error) {
      console.error('Error restoring cache:', error)
    }
  }

  /**
   * Find user by pseudo with caching
   */
  async findUserByPseudo(pseudo) {
    const key = this.getCacheKey('userFind', { pseudo })
    
    return await this.getOrFetch(key, async () => {
      console.log(`🔍 [API MANAGER] Finding user by pseudo: ${pseudo}`)
      
      const { findUserByPseudo } = await import('./userService')
      const result = await findUserByPseudo(pseudo)
      
      console.log(`✅ [API MANAGER] Found user: ${result?.pseudo || 'not found'}`)
      return result
    }, this.cacheTTL.user)
  }

  /**
   * Find user by ID with caching to reduce duplicate API calls
   */
  async findUserByUserId(userId) {
    const key = this.getCacheKey('user', { userId })
    
    return await this.getOrFetch(key, async () => {
      console.log(`🔍 [API MANAGER] Finding user by ID: ${userId}`)
      
      const { findUserByUserId } = await import('./userService')
      const result = await findUserByUserId(userId)
      
      console.log(`✅ [API MANAGER] Found user: ${result?.pseudo || 'not found'}`)
      return result
    }, this.cacheTTL.user)
  }

  /**
   * Patch 4: Batch mark messages as read up to a timestamp
   * Replaces per-message update calls with single RPC
   */
  async markMessagesReadUpTo(currentUserId, otherUserId, beforeTimestamp) {
    if (!currentUserId || !otherUserId || !beforeTimestamp) return

    try {
      console.log(`📝 [API MANAGER] Batch marking messages read: ${currentUserId} <- ${otherUserId} before ${beforeTimestamp}`)

      // No Edge Function: perform DB update so realtime broadcasts fire
      const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(beforeTimestamp)
      const beforeISO = hasTimezone ? beforeTimestamp : (beforeTimestamp.endsWith('Z') ? beforeTimestamp : beforeTimestamp + 'Z')
      const seenAt = new Date().toISOString()
      let updatedIds = []
      try {
        // Prefer RPC if present
        const { data: rpcData, error: rpcErr } = await supabase.rpc('fn_mark_messages_read_by_pair', {
          p_receiver_id: currentUserId,
          p_sender_id: otherUserId,
          p_before: beforeISO
        })
        if (rpcErr) {
          if (__DEV__) console.warn('⚠️ [API MANAGER] RPC unavailable, using direct update:', rpcErr?.message)
          const { data, error } = await supabase
            .from('messages')
            .update({ seen: true, seen_at: seenAt })
            .eq('receiver_id', currentUserId)
            .eq('sender_id', otherUserId)
            .lte('created_at', beforeISO)
            .eq('seen', false)
            .eq('view_once', false)
            .eq('is_nsfw', false)
            .select('id')
          if (error) throw error
          updatedIds = Array.isArray(data) ? data.map(r => r.id) : []
        } else {
          updatedIds = Array.isArray(rpcData) ? rpcData.map(r => r.updated_id || r.id || r) : []
        }
      } catch (dbErr) {
        console.error('❌ [API MANAGER] DB mark-read failed:', dbErr)
        throw dbErr
      }

      // Optimistic local updates (no extra fetch)
      try {
        const { chatStore } = await import('../data/stores/chatStore')
        const { messagesCache } = await import('../data/messagesCache')
        chatStore.markUntilTimestampAsSeenPair({ receiverId: currentUserId, senderId: otherUserId, beforeISO: beforeTimestamp })
        await messagesCache.markUntilTimestampAsSeenPair(currentUserId, otherUserId, beforeTimestamp)
      } catch {}

      // Emit local events immediately (UI feels instant; broadcast will also arrive)
      try {
        const { realtimeCacheManager } = await import('./realtimeCacheManager')
        const eventPayload = {
          receiverId: currentUserId,
          senderId: otherUserId,
          messageIds: updatedIds,
          // Include a best-effort single messageId for handlers that expect it
          messageId: Array.isArray(updatedIds) && updatedIds.length > 0 ? updatedIds[updatedIds.length - 1] : undefined,
          seenAt,
          by: currentUserId
        }
        realtimeCacheManager.emit('messageRead', eventPayload)
        realtimeCacheManager.emit('messageReadStatusUpdated', eventPayload)
        // Also nudge conversations to refresh counts/indicators
        realtimeCacheManager.emit('conversationUpdate', {
          type: 'messages_marked_read',
          receiverId: currentUserId,
          senderId: otherUserId,
          timestamp: new Date().toISOString(),
        })
      } catch {}

      // Update in-memory apiManager caches in-place for both perspectives
      try {
        const cutoff = Date.parse(beforeISO)
        const updateKey = (a, b) => `messages_currentUserId:${a}|otherUserId:${b}`
        const keys = [updateKey(currentUserId, otherUserId), updateKey(otherUserId, currentUserId)]
        keys.forEach(k => {
          const arr = this.getFromCache(k)
          if (Array.isArray(arr) && arr.length > 0) {
            const updated = arr.map(m => {
              const isPair = ((m.receiver_id === currentUserId && m.sender_id === otherUserId) || (m.receiver_id === otherUserId && m.sender_id === currentUserId))
              const within = Date.parse(m.created_at) <= cutoff
              if (isPair && within && !m.seen) {
                return { ...m, seen: true, seen_at: new Date().toISOString() }
              }
              return m
            })
            this.setCache(k, updated)
          }
        })
      } catch (e) {
        if (__DEV__) console.warn('⚠️ [API MANAGER] Failed to update in-memory caches for mark-read', e)
      }

      // CRITICAL FIX: Avoid clearing the unified conversations cache here - that can race with realtime
      // Instead, invalidate legacy cache keys to support older code paths while leaving
      // the unified `conversations_<userId>` cache intact for realtime updates.
      try {
        // Clear legacy cache formats that some parts of the app may still read
        this.clearCachePattern(`^conversations_userId:${currentUserId}`)
        this.clearCachePattern(`^conversation_userId:${currentUserId}`)
        if (__DEV__) console.log('📝 [API MANAGER] Cleared legacy conversation cache patterns after mark-read')
      } catch (e) {
        if (__DEV__) console.warn('⚠️ [API MANAGER] Failed to clear legacy conversation cache patterns:', e)
      }

      console.log(`✅ [API MANAGER] Messages marked as read in batch`)
    } catch (error) {
      console.error('❌ [API MANAGER] Failed to mark messages as read:', error)
      throw error
    }
  }

  // Add this tiny helper once in APIManager (top-level methods section)
  getSupabaseUrl() {
    // align with services/supabaseClient.js which reads expo extra
    if (!this._supabaseUrl) {
      // lazy load to avoid import cycles
      const Constants = require('expo-constants').default
      this._supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl
    }
    return this._supabaseUrl
  }
}

// Export singleton instance
export const apiManager = new APIManager()
