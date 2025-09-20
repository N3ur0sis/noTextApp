/**
 * Optimized Messages Hook - Production Ready
 * Uses centralized API manager with advanced caching strategies
 * Implements progressive loading, virtual windowing and memory optimization
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiManager } from '../services/apiManager';
import { realtimeCacheManager } from '../services/realtimeCacheManager';
import { nsfwViewService } from '../services/nsfwViewService';
import { backgroundMessageService } from '../services/backgroundMessageService';

// Constants for optimization
const MIN_FETCH_INTERVAL = 3000; // INCREASED to 3 seconds to reduce API spam
const MESSAGE_BATCH_SIZE = 30;   // Load messages in batches
const DEBOUNCE_TIME = 300;      // REDUCED debounce time for more responsive realtime updates

const useSimpleMessages = (currentUserId, otherUserId) => {
  // State with optimized memory management
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false) // Changed: Start with false to avoid loading screen
  const [error, setError] = useState(null)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)
  
  // Refs for optimization
  const lastFetchRef = useRef(0);
  const debounceTimeoutRef = useRef(null);
  const fetchDebounceRef = useRef(null); // Add separate debounce for fetchMessages
  const isMountedRef = useRef(true);
  const pendingOperationsRef = useRef(new Set());
  const messagesRef = useRef([]); // Add ref to store current messages
  
  // Update ref when messages change
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  
  // Create a stable conversation ID for caching and reference
  const conversationId = useMemo(() => {
    if (!currentUserId || !otherUserId) return null;
    // Always order IDs consistently
    const [first, second] = [currentUserId, otherUserId].sort();
    return `${first}_${second}`;
  }, [currentUserId, otherUserId]);
  
  // Optimized message fetching with intelligent state updates and pagination
  const fetchMessages = useCallback(async (options = {}) => {
    const { 
      forceRefresh = false, 
      loadMore = false,
      limit = MESSAGE_BATCH_SIZE
    } = options;
    
    // Early return if no IDs
    if (!currentUserId || !otherUserId) {
      if (isMountedRef.current) {
        setMessages([]);
        setLoading(false);
        setHasMore(false);
      }
      return [];
    }

    // Track this operation to prevent race conditions
    const operationId = Date.now().toString();
    pendingOperationsRef.current.add(operationId);

    try {
      // Rate limiting for non-forced fetches
      const now = Date.now();
      if (!forceRefresh && !loadMore && now - lastFetchRef.current < MIN_FETCH_INTERVAL) {
        if (__DEV__) console.log(`🔄 [MESSAGES] Skipping fetch, too soon (${now - lastFetchRef.current}ms)`);
        // Use ref to get current messages without dependency
        return messagesRef.current;
      }
      
      lastFetchRef.current = now;
      if (isMountedRef.current && !loadMore) setError(null);
      
      // Calculate offset based on current page or reset for refresh
      const currentPage = loadMore ? page + 1 : 0;
      const offset = loadMore ? messages.length : 0;
      
      let data;
      if (forceRefresh) {
        if (__DEV__) console.log(`🔄 [MESSAGES] Force refreshing`);
        data = await apiManager.refreshMessages(currentUserId, otherUserId, { limit });
        
        // For refreshes, we reset pagination state
        if (isMountedRef.current) {
          setPage(0);
          setHasMore(data.length === limit);
        }
      } else if (loadMore) {
        if (__DEV__) console.log(`� [MESSAGES] Loading more, page ${currentPage}`);
        // Get more messages with pagination
        data = await apiManager.getMessages(currentUserId, otherUserId, { 
          offset, 
          limit,
          includeExisting: false
        });
        
        // Update pagination state
        if (isMountedRef.current) {
          setPage(currentPage);
          setHasMore(data.length === limit);
        }
        
        // Combine with existing messages, maintaining order and deduplicating
        const existingIds = new Set(messagesRef.current.map(m => m.id));
        const newMessages = [...messagesRef.current];
        
        data.forEach(message => {
          if (!existingIds.has(message.id)) {
            newMessages.push(message);
            existingIds.add(message.id);
          }
        });
        
        // Sort by timestamp (oldest first - chronological order for chat display)
        newMessages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        data = newMessages;
      } else {
        if (__DEV__) console.log(`📦 [MESSAGES] Getting messages (cache-first)`);
        data = await apiManager.getMessages(currentUserId, otherUserId, { limit });
        
        // For initial loads, set pagination state
        if (isMountedRef.current) {
          setPage(0);
          setHasMore(data.length === limit);
        }
      }
      
      // Filter out viewed NSFW messages for both senders and receivers
      if (data && currentUserId) {
        // Import NSFW service for filtering
        const { nsfwViewService } = await import('../services/nsfwViewService')
        
        // Sync NSFW service with database state before filtering
        await nsfwViewService.syncWithDatabase(data)
        
        data = data.filter(message => {
          // Keep all non-NSFW messages
          if (!message.is_nsfw) return true
          
          // For NSFW messages, filter out if already viewed by the receiver
          // This applies to both sender and receiver sides
          const isViewedByService = nsfwViewService.isViewed(message.id)
          if (message.receiver_id && isViewedByService) {
            if (__DEV__) console.log(`🔥 [MESSAGES] Filtering out viewed NSFW message: ${message.id}`)
            return false // Remove from both sender and receiver views once receiver has viewed it
          }
          
          return true
        })
        
        if (__DEV__) console.log(`🔥 [MESSAGES] Filtered NSFW messages, remaining: ${data.length}`)
      }
      
      // Update state only if component is still mounted and this is the most recent operation
      if (isMountedRef.current && pendingOperationsRef.current.has(operationId)) {
        setMessages(data);
        setLoading(false);
        if (__DEV__) console.log(`✅ [MESSAGES] Updated ${data.length} messages`);
      }
      
      return data;
    } catch (err) {
      console.error('❌ [MESSAGES] Error loading messages:', err);
      // Update state only if component is still mounted and this is the most recent operation
      if (isMountedRef.current && pendingOperationsRef.current.has(operationId)) {
        setError(err);
        setLoading(false);
      }
      return messagesRef.current;
    } finally {
      // Clean up this operation
      pendingOperationsRef.current.delete(operationId);
    }
  }, [currentUserId, otherUserId, page]); // Removed 'messages' to prevent circular dependency

  // Load messages on mount or when conversation changes
  useEffect(() => {
    isMountedRef.current = true;
    
    // Reset state on conversation change
    setMessages([]);
    setLoading(true);
    setError(null);
    setPage(0);
    setHasMore(true);
    
    // Call fetchMessages directly to avoid circular dependency
    fetchMessages();
    
    return () => {
      isMountedRef.current = false;
      // Clear any pending timeouts
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      if (fetchDebounceRef.current) {
        clearTimeout(fetchDebounceRef.current);
      }
    };
  }, [conversationId]); // Remove fetchMessages from dependency to prevent infinite loop

  // Optimized realtime updates with smart diffing
  useEffect(() => {
    if (!conversationId) return;

    // Use ref to get current messages without adding to dependencies
    const getCurrentMessages = () => messagesRef.current;

    // Unified event handler to avoid duplicate code
    const handleRealtimeUpdate = (data, eventType) => {
      // Only process events for this conversation
      const isRelevant = (
        (data.message?.sender_id === currentUserId && data.message?.receiver_id === otherUserId) ||
        (data.message?.sender_id === otherUserId && data.message?.receiver_id === currentUserId) ||
        (data.senderId === currentUserId && data.receiverId === otherUserId) ||
        (data.senderId === otherUserId && data.receiverId === currentUserId)
      );

      if (!isRelevant) return;
      
      // OPTIMIZATION: Prevent duplicate processing of the same event
      const eventKey = `${eventType}_${data?.message?.id || data?.messageId || Date.now()}`;
      if (pendingOperationsRef.current.has(eventKey)) {
        if (__DEV__) console.log(`⏳ [MESSAGES] Skipping duplicate realtime event: ${eventKey}`);
        return;
      }
      
      // Mark event as being processed
      pendingOperationsRef.current.add(eventKey);
      
      // Clean up after processing
      setTimeout(() => {
        pendingOperationsRef.current.delete(eventKey);
      }, 1000);
      
      if (__DEV__) console.log(`🔄 [MESSAGES] Realtime update for conversation: ${conversationId}, event: ${eventType || 'unknown'}`);
      
      // Smart update: avoid invalidating the full cache. Instead, update in-memory
      // for immediate responsiveness and let targeted cache updates persist changes.
      const messageKey = apiManager.getCacheKey('messages', { currentUserId, otherUserId });
      // If we have the message object, try an in-place cache update
      if (data && data.message && data.message.id) {
        try {
          // Read existing authoritative array and perform a safe merge/replace
          let cached = apiManager.getFromCache(messageKey)
          if (!Array.isArray(cached)) cached = []

          const matchesExisting = (existing) => {
            if (!existing) return false
            try {
              if (data.message.id && existing.id === data.message.id) return true
              if (data.message.id && (existing._tempId === data.message.id || existing.tempId === data.message.id)) return true
              if ((data.message._tempId || data.message.tempId) && existing.id && (existing.id === data.message._tempId || existing.id === data.message.tempId)) return true
            } catch (e) {}
            return false
          }

          const existingIndex = cached.findIndex(matchesExisting)
          if (existingIndex >= 0) {
            // Replace optimistic entry
            cached[existingIndex] = { ...cached[existingIndex], ...data.message }
            apiManager.setCache(messageKey, cached)
          } else {
            // Append then dedupe prefer non-optimistic messages
            cached.push(data.message)
            const seen = new Set()
            const dedupedReversed = []
            for (let i = cached.length - 1; i >= 0; i--) {
              const m = cached[i]
              if (!m) continue
              const ids = [m.id, m._tempId, m.tempId].filter(Boolean)
              const already = ids.some(id => seen.has(id))
              if (already) continue
              ids.forEach(id => seen.add(id))
              dedupedReversed.push(m)
            }
            const merged = dedupedReversed.reverse()
            apiManager.setCache(messageKey, merged)
          }
        } catch (e) {
          if (__DEV__) console.warn('⚠️ [MESSAGES] Failed to perform targeted cache set for', messageKey, e)
        }
      }
      
      // Use shared debouncing logic for all event types
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      
      // Smart refresh strategy - optimistic updates for common events
      if ((data.type === 'read' && data.messageId) || eventType === 'messageRead' || eventType === 'messageReadStatusUpdated') {
        // Optimistic update for read status without fetching
        const targetMessageId = data.messageId || data.message?.id;
        if (targetMessageId) {
          if (__DEV__) console.log(`✅ [MESSAGES] Optimistically updating read status for message: ${targetMessageId}`);
          setMessages(prevMessages => 
            prevMessages.map(m => 
              m.id === targetMessageId 
                ? { ...m, read: true, seen: true, read_at: data.readAt || data.timestamp || new Date().toISOString() } 
                : m
            )
          );
        }
      } else if (data.message && data.message.id) {
        // Optimistic insert for new messages with proper deduplication
        setMessages(prevMessages => {
          // Check if message already exists
          const messageExists = prevMessages.some(m => m.id === data.message.id);
          if (messageExists) {
            if (__DEV__) console.log(`🔄 [MESSAGES] Message ${data.message.id} already exists, skipping optimistic insert`);
            return prevMessages; // No change if message already exists
          }
          
          if (__DEV__) console.log(`✅ [MESSAGES] Adding new message optimistically: ${data.message.id}`);
          const updatedMessages = [data.message, ...prevMessages];
          // Keep sorted by timestamp (oldest first - chronological order for chat display)
          updatedMessages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          return updatedMessages;
        });
      }
      
      // Schedule a full refresh to ensure consistency
      debounceTimeoutRef.current = setTimeout(() => {
        fetchMessages({ forceRefresh: true });
        debounceTimeoutRef.current = null;
      }, DEBOUNCE_TIME);
    };

    // Map of events to handle
    const eventHandlers = {};
    const eventTypes = ['messageReceived', 'messageSent', 'messageReadStatusUpdated', 'messageRead', 'messageDeleted'];
    
    eventTypes.forEach(eventType => {
      eventHandlers[eventType] = (data) => handleRealtimeUpdate(data, eventType);
    });
    
    if (__DEV__) console.log(`📡 [MESSAGES] Setting up realtime listeners for conversation: ${conversationId}`);
    
    // Register all handlers
    Object.entries(eventHandlers).forEach(([event, handler]) => {
      realtimeCacheManager.on(event, handler);
    });

    return () => {
      if (__DEV__) console.log(`🧹 [MESSAGES] Cleaning up realtime listeners for conversation: ${conversationId}`);
      // Clean up all handlers
      Object.entries(eventHandlers).forEach(([event, handler]) => {
        realtimeCacheManager.off(event, handler);
      });
    };
  }, [conversationId, currentUserId, otherUserId]); // Remove fetchMessages from dependency

  // Combine messages with optimistic messages from background service
  const combinedMessages = useMemo(() => {
    if (!currentUserId || !otherUserId) return messages

    // Get pending optimistic messages for this conversation
    const pendingMessages = backgroundMessageService.getAllPendingMessages()
      .filter(msg => 
        (msg.sender_id === currentUserId && msg.receiver_id === otherUserId) ||
        (msg.sender_id === otherUserId && msg.receiver_id === currentUserId)
      )

    // Combine and sort
    const combined = [...messages, ...pendingMessages]
    combined.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    
    return combined
  }, [messages, currentUserId, otherUserId])

  // Initialize messages on mount - fetch from cache immediately
  useEffect(() => {
    if (!currentUserId || !otherUserId) return
    
    // First, try to get cached data immediately to avoid loading screen
    const cachedMessages = apiManager.getCachedMessages(currentUserId, otherUserId)
    if (cachedMessages && cachedMessages.length > 0) {
      if (__DEV__) console.log(`⚡ [MESSAGES] Using cached data immediately: ${cachedMessages.length} messages`)
      setMessages(cachedMessages)
      setLoading(false)
      
      // Still fetch fresh data in background but don't show loading
      fetchMessages({ forceRefresh: false }).catch((error) => {
        if (isMountedRef.current) {
          setError(error)
        }
      })
    } else {
      // No cache available, show loading and fetch
      if (__DEV__) console.log(`📡 [MESSAGES] No cache available, fetching with loading state`)
      setLoading(true)
      
      fetchMessages()
        .then(() => {
          if (isMountedRef.current) {
            setLoading(false)
          }
        })
        .catch((error) => {
          if (isMountedRef.current) {
            setError(error)
            setLoading(false)
          }
        })
    }
  }, [currentUserId, otherUserId, fetchMessages])

  // Enhanced API with additional capabilities
  return {
    messages: combinedMessages,
    loading,
    error,
    hasMore,
    loadMore: useCallback(() => {
      if (hasMore && !loading) {
        return fetchMessages({ loadMore: true });
      }
      return Promise.resolve(combinedMessages);
    }, [fetchMessages, hasMore, loading, combinedMessages]), // Add combinedMessages dependency
    refresh: useCallback(() => {
      return fetchMessages({ forceRefresh: true });
    }, [fetchMessages]),
    sendMessage: useCallback(async (content) => {
      if (!currentUserId || !otherUserId || !content) {
        return null;
      }
      
      try {
        // Optimistic UI update
        const optimisticId = `temp-${Date.now()}`;
        const optimisticMessage = {
          id: optimisticId,
          content,
          sender_id: currentUserId,
          receiver_id: otherUserId,
          created_at: new Date().toISOString(),
          read: false,
          sending: true
        };
        
        setMessages(prev => [optimisticMessage, ...prev]);
        
        // Send the actual message
        const result = await apiManager.sendMessage(currentUserId, otherUserId, content);
        
        // Replace optimistic message with real one
        setMessages(prev => 
          prev.map(m => m.id === optimisticId ? { ...result, sending: false } : m)
        );
        
        return result;
      } catch (err) {
        console.error('❌ [MESSAGES] Error sending message:', err);
        // Mark optimistic message as failed
        setMessages(prev => 
          prev.map(m => m.id === optimisticId ? { ...m, sending: false, failed: true } : m)
        );
        throw err;
      }
    }, [currentUserId, otherUserId]),
    markAsRead: useCallback(async (messageId) => {
      if (!messageId) return;
      
      try {
        // Optimistic update
        setMessages(prev => 
          prev.map(m => m.id === messageId ? { ...m, read: true, read_at: new Date().toISOString() } : m)
        );
        
        // Update on server
        await apiManager.markMessageAsRead(messageId, currentUserId);
      } catch (err) {
        console.error('❌ [MESSAGES] Error marking as read:', err);
        // Revert optimistic update on error
        setMessages(prev => 
          prev.map(m => m.id === messageId ? { ...m, read: false, read_at: null } : m)
        );
      }
    }, [currentUserId]),
    removeNsfwMessage: useCallback((messageId) => {
      if (!messageId) return;
      
      // Optimistic removal - immediately remove from local state
      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== messageId);
        if (__DEV__) console.log(`🔥 [MESSAGES] Optimistically removed NSFW message: ${messageId}`);
        return filtered;
      });
    }, [])
  };
};

export { useSimpleMessages };

