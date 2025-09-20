/**
 * Sliding Window Messages Hook - Performance Optimized
 * Maintains only the 5 most recent messages for optimal performance
 * Designed specifically for ChatScreen with minimal memory footprint
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiManager } from '../services/apiManager';
import { realtimeCacheManager } from '../services/realtimeCacheManager';
import { nsfwViewService } from '../services/nsfwViewService';
import { backgroundMessageService } from '../services/backgroundMessageService';
import { messagesCache } from '../data/messagesCache';
import { chatStore } from '../data/stores/chatStore';

// Performance constants - optimized for slow devices and Android
const SLIDING_WINDOW_SIZE = 10;        // Only keep 5 messages in memory
const MIN_FETCH_INTERVAL = 500;        // Reduce cooldown to make realtime feels snappier
const CACHE_TTL = 15000;              // Reduced to 15 seconds to get fresher data more quickly
const DEBOUNCE_TIME = 100;            // Further reduced debounce for even snappier real-time updates
const READ_RECEIPT_DEBOUNCE = 50;     // Even faster debounce for read receipts
const MAX_CACHE_SIZE = 10;            // Limit cache size to prevent memory bloat
const MAX_FETCH_LIMIT = 20;           // Maximum messages to fetch when looking for displayable ones
const MAX_BACKFILL_PAGES = 4;         // Extra pages to fetch when displayable < window size

// Helper function to validate message objects and filter out invalid ones
const isValidMessage = (message) => {
  if (!message || typeof message !== 'object') {
    return false;
  }
  
  // Must have essential message properties
    const hasRequiredFields = (
      (message.id !== undefined && message.id !== null) &&
      message.created_at &&
      (typeof message.sender_id === 'string' || typeof message.sender_id === 'number') &&
      (typeof message.receiver_id === 'string' || typeof message.receiver_id === 'number')
    );
  
  if (!hasRequiredFields) {
    if (__DEV__) {
      console.warn('🚨 [SLIDING] Invalid message missing required fields:', {
        id: message.id,
        created_at: message.created_at,
        sender_id: message.sender_id,
        receiver_id: message.receiver_id,
        type: message.type,
        messageType: typeof message,
        hasType: 'type' in message,
        hasConversationId: 'conversationId' in message,
        hasEventType: 'eventType' in message
      });
    }
    return false;
  }
  
  // Filter out realtime event objects that get mixed in
  if (message.type === 'message_read' || message.conversationId || message.eventType || message.timestamp) {
    if (__DEV__) {
      console.warn('🚨 [SLIDING] Filtering out realtime event object:', {
        id: message.id,
        type: message.type,
        eventType: message.eventType,
        conversationId: message.conversationId,
        timestamp: message.timestamp,
        isNsfw: message.isNsfw,
        users: message.users
      });
    }
    return false;
  }
  
  return true;
};

// Dedupe helper: prefer non-optimistic messages when duplicates exist - ENHANCED
const dedupeMessages = (arr = []) => {
  if (!Array.isArray(arr) || arr.length === 0) return [];

  // First, remove any undefined/null messages
  const validMessages = arr.filter(Boolean);

  // Use Map to track unique messages by multiple keys
  const seenKeys = new Map();
  const uniqueMessages = [];

  validMessages.forEach((message) => {
    if (!message) return;

    // Create multiple potential keys for the same message
    const possibleKeys = [
      message.id,
      message._tempId,
      message.tempId
    ].filter(Boolean);

    // For optimistic messages without stable IDs, add content-based key
    if (!message.id && message._isSending) {
      const contentKey = `${message.sender_id}-${message.receiver_id}-${message.created_at}-${typeof message.content === 'string' ? message.content.slice(0, 50) : 'media'}`;
      possibleKeys.push(contentKey);
    }

    // Check if we've seen any of these keys before
    let existingIndex = -1;
    for (const key of possibleKeys) {
      if (seenKeys.has(key)) {
        existingIndex = seenKeys.get(key);
        break;
      }
    }

    if (existingIndex >= 0) {
      // We have a duplicate - decide which one to keep
      const existing = uniqueMessages[existingIndex];
      const isCurrentOptimistic = !!(message._isSending);
      const isExistingOptimistic = !!(existing._isSending);

      // Prefer real messages over optimistic ones
      if (isExistingOptimistic && !isCurrentOptimistic && message.id) {
        // Replace optimistic with real message
        uniqueMessages[existingIndex] = message;
        // Update all keys to point to this message
        possibleKeys.forEach(key => seenKeys.set(key, existingIndex));
      }
      // If both are optimistic or both are real, keep the first one
    } else {
      // New message - add it
      const newIndex = uniqueMessages.length;
      uniqueMessages.push(message);
      // Store all possible keys for this message
      possibleKeys.forEach(key => seenKeys.set(key, newIndex));
    }
  });

  return uniqueMessages;
};

// EGRESS OPTIMIZATION: Coordinated media preloading to batch storage operations
const preloadMessageMedia = async (messagesArray) => {
  if (!messagesArray || messagesArray.length === 0) return;
  
  try {
    // Collect all media URLs that need signing
    const mediaUrls = [];
    const thumbnailUrls = [];
    
    messagesArray.forEach(message => {
      if (message.media_url && !message.media_url.startsWith('file://')) {
        mediaUrls.push(message.media_url);
      }
      if (message.thumbnail_url && !message.thumbnail_url.startsWith('file://')) {
        thumbnailUrls.push(message.thumbnail_url);
      }
    });
    
    const allUrls = [...mediaUrls, ...thumbnailUrls];
    
    if (allUrls.length > 0) {
      const { getSignedUrlsBatch } = await import('../services/unifiedMediaService');
      console.log(`🎯 [SLIDING] Batch pre-signing ${allUrls.length} media URLs for chat screen`);
      await getSignedUrlsBatch(allUrls);
      console.log(`✅ [SLIDING] Successfully pre-signed all media URLs`);
    }
  } catch (error) {
    console.warn('⚠️ [SLIDING] Failed to batch pre-sign media URLs:', error);
  }
};

const useSlidingWindowMessages = (currentUserId, otherUserId, isChatVisible = false, pairId = null) => {
  console.log('🔵 [TRACE] useSlidingWindowMessages called', { currentUserId, otherUserId });
  // Minimal state for performance
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastMessageId, setLastMessageId] = useState(null) // Track latest message for efficient updates
  const [optimisticUpdateCounter, setOptimisticUpdateCounter] = useState(0) // Force re-renders when optimistic messages change
  console.log('🔵 [TRACE] useSlidingWindowMessages state', { messages, loading, error, lastMessageId, optimisticUpdateCounter });
  
  // Performance optimization refs
  const lastFetchRef = useRef(0);
  const debounceTimeoutRef = useRef(null);
  const isMountedRef = useRef(true);
  const pendingOperationsRef = useRef(new Set());
  const messagesRef = useRef([]);
  const cacheRef = useRef(new Map()); // Local cache for instant loading
  const renderCountRef = useRef(0); // Track re-renders for optimization
  
  // Update ref when messages change
  useEffect(() => {
    console.log('🔵 [TRACE] useEffect (fetchMessages)');
    messagesRef.current = messages;
    // CRITICAL FIX: Only set lastMessageId from valid messages
    const validMessages = messages.filter(isValidMessage);
    if (validMessages.length > 0) {
      setLastMessageId(validMessages[validMessages.length - 1]?.id);
    }
  }, [messages]);
  
  // Create stable conversation ID
  const conversationId = useMemo(() => {
    if (!currentUserId || !otherUserId) return null;
    const [first, second] = [currentUserId, otherUserId].sort();
    return `${first}_${second}`;
  }, [currentUserId, otherUserId]);
  
  // Smart cache key for sliding window
  const cacheKey = useMemo(() => {
    return conversationId ? `sliding_${conversationId}` : null;
  }, [conversationId]);

  // Get cached messages instantly
  const getCachedMessages = useCallback(() => {
    if (!cacheKey) return [];
    
    // First check local cache
    const cached = cacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
    
    // CRITICAL FIX: Also check apiManager cache for real-time updates
    if (currentUserId && otherUserId) {
      const apiCacheKey = `messages_currentUserId:${currentUserId}|otherUserId:${otherUserId}`;
      const apiCached = apiManager.getFromCache(apiCacheKey);
      if (apiCached && Array.isArray(apiCached)) {
        console.log('📦 [SLIDING] Found messages in apiManager cache:', apiCached.length);

        // Prepare a displayable window: exclude viewed NSFW, keep latest
        let validMessages = apiCached.filter(isValidMessage);
        // Use a larger slice to compensate for NSFW filtering
        validMessages = validMessages.slice(-Math.max(SLIDING_WINDOW_SIZE * 4, MAX_FETCH_LIMIT));

        let displayable = validMessages.filter(m => !m?.is_nsfw || !nsfwViewService.isViewed(m.id));
        // Ensure chronological order before slicing last N
        displayable.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const slidingWindow = displayable.slice(-SLIDING_WINDOW_SIZE);

        // Update local cache with this data
        cacheRef.current.set(cacheKey, {
          data: slidingWindow,
          timestamp: Date.now()
        });

        return slidingWindow;
      }
    }
    
    // CRITICAL FIX: If we have optimistic messages but no cached data, don't return empty array
    // This prevents showing empty chat when messages are being sent
    const pendingMessages = backgroundMessageService.getAllPendingMessages()
      .filter(msg => 
        (msg.sender_id === currentUserId && msg.receiver_id === otherUserId) ||
        (msg.sender_id === otherUserId && msg.receiver_id === currentUserId)
      )
      .filter(isValidMessage);
      
    if (pendingMessages.length > 0) {
      console.log('📦 [SLIDING] No cache but have pending messages, returning empty for fresh fetch:', pendingMessages.length);
    }
    
    return [];
  }, [cacheKey, currentUserId, otherUserId]);

  // Cache messages locally for instant access with size limit
  const cacheMessages = useCallback((messagesToCache) => {
    if (!cacheKey || !messagesToCache) return;
    
    // Implement cache size limit to prevent memory bloat on Android
    if (cacheRef.current.size >= MAX_CACHE_SIZE) {
      // Remove oldest cache entries (simple LRU)
      const oldestKey = cacheRef.current.keys().next().value;
      cacheRef.current.delete(oldestKey);
    }
    
    cacheRef.current.set(cacheKey, {
      data: messagesToCache,
      timestamp: Date.now()
    });
  }, [cacheKey]);

  // Optimized sliding window message fetching with request deduplication
  const fetchMessages = useCallback(async (options = {}) => {
    const { forceRefresh = false, silent = false } = options;
    
    if (!currentUserId || !otherUserId) {
      if (isMountedRef.current) {
        setMessages([]);
        setLoading(false);
      }
      return [];
    }

    // EGRESS OPTIMIZATION: Global request deduplication - prevent ANY concurrent message requests for same conversation
    // Use simpler key that covers all request types (different limits, force refresh, etc.)
    const globalRequestKey = `messages_${currentUserId}_${otherUserId}`;
    if (pendingOperationsRef.current.has(globalRequestKey)) {
      if (__DEV__) {
        console.log(`⏳ [SLIDING] Message request already in progress for conversation ${globalRequestKey}, waiting...`);
      }
      // Wait for ANY existing message request to complete
      let attempts = 0;
      while (pendingOperationsRef.current.has(globalRequestKey) && attempts < 50) { // Max 5 seconds wait
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      // Return current messages or cached messages after wait
      const currentMessages = messagesRef.current.length > 0 ? messagesRef.current : getCachedMessages();
      return currentMessages;
    }

    // Check cache first for instant loading
    if (!forceRefresh) {
      const cached = getCachedMessages();
      if (cached.length >= SLIDING_WINDOW_SIZE) {
        if (isMountedRef.current) {
          setMessages(cached);
          setLoading(false);
        }
        
        // EGRESS OPTIMIZATION: If we have ANY cached messages, use them instead of fetching more
        // This prevents duplicate API calls when navigation pre-warming provides some data
        if (__DEV__) {
          console.log(`� [SLIDING] Using ${cached.length} cached messages, skipping fresh fetch to prevent duplicate API calls`);
        }
        return cached;
      } else if (cached.length > 0) {
        // Use the small cache for instant paint, but continue to fetch to backfill to full window
        if (isMountedRef.current) {
          setMessages(cached);
          setLoading(false);
        }
        if (__DEV__) {
          console.log(`🔄 [SLIDING] Cached < window (${cached.length}/${SLIDING_WINDOW_SIZE}); will fetch to backfill`);
        }
        // Do not return here — continue to fetch below
      }
    }

    // EGRESS OPTIMIZATION: Smarter rate limiting - only block if we have recent cached data
    const now = Date.now();
    const timeSinceLastFetch = now - lastFetchRef.current;
    const hasRecentCache = getCachedMessages().length >= SLIDING_WINDOW_SIZE;
    
    if (!forceRefresh && timeSinceLastFetch < MIN_FETCH_INTERVAL && hasRecentCache) {
      if (__DEV__) {
        console.log(`⏸️ [SLIDING] Rate limited: last fetch was ${Math.round(timeSinceLastFetch/1000)}s ago, using cache instead`);
      }
      return messagesRef.current;
    }

    // Mark request as in progress with global key
    pendingOperationsRef.current.add(globalRequestKey);

    const operationId = Date.now().toString();
    pendingOperationsRef.current.add(operationId);

    try {
      lastFetchRef.current = now;
      if (isMountedRef.current && !silent) {
        setLoading(true);
        setError(null);
      }

  // EGRESS OPTIMIZATION: Fetch an oversampled candidate set so post-fetch
  // filtering (NSFW/invalid messages) doesn't shrink the visible sliding window.
  // Bound oversample with MAX_FETCH_LIMIT to avoid excessive payloads.
  let data;
  // Oversample aggressively to ensure we can fill window after NSFW filtering
  const fetchLimit = MAX_FETCH_LIMIT;
      
      if (forceRefresh) {
        data = await apiManager.refreshMessages(currentUserId, otherUserId, { 
          limit: fetchLimit,
          orderBy: 'created_at',
          orderDirection: 'desc'
        });
      } else {
        data = await apiManager.getMessages(currentUserId, otherUserId, { 
          limit: fetchLimit,
          orderBy: 'created_at',
          orderDirection: 'desc'
        });
      }
      if (data && data.length > 0) {
        // CRITICAL FIX: Filter out invalid messages FIRST
        data = data.filter(isValidMessage);
        
        if (data.length === 0) {
          if (__DEV__) {
            console.warn('🚨 [SLIDING] All fetched messages were invalid, continuing with empty array');
          }
        } else {
          // Sort by created_at ascending for chat display (oldest first)
          data.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          
          // Filter out viewed NSFW messages for current user (displayable = non-NSFW OR NSFW not viewed)
          if (currentUserId) {
            const beforeFilterCount = data.length;
            data = data.filter(message => {
              if (!message.is_nsfw) return true;
              // Only hide NSFW that have been explicitly viewed via NSFW service
              const isViewed = nsfwViewService.isViewed(message.id);
              const shouldShow = !isViewed;
              
              if (__DEV__ && !shouldShow) {
                console.log(`🔥 [SLIDING] Filtering out viewed NSFW message: ${message.id}, isViewed: ${isViewed}`);
              }
              
              return shouldShow;
            });
            if (__DEV__ && beforeFilterCount !== data.length) {
              console.log(`🔥 [SLIDING] Filtered ${beforeFilterCount - data.length} viewed NSFW messages, got ${data.length} displayable messages`);
            }
          }
          
          // Backfill if after filtering we still have < window size
          let backfillPages = 0;
          while (data.length < SLIDING_WINDOW_SIZE && backfillPages < MAX_BACKFILL_PAGES) {
            try {
              const oldest = data[0] || null;
              const beforeTs = oldest ? oldest.created_at : undefined;
              if (!beforeTs) break;
              const more = await apiManager.getMessages(currentUserId, otherUserId, {
                limit: MAX_FETCH_LIMIT,
                orderBy: 'created_at',
                orderDirection: 'desc',
                before: beforeTs
              });
              if (!Array.isArray(more) || more.length === 0) break;
              let cleaned = more.filter(isValidMessage);
              cleaned.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
              if (currentUserId) {
                cleaned = cleaned.filter(m => !m.is_nsfw || !nsfwViewService.isViewed(m.id));
              }
              // Merge without duplicates
              const existingIds = new Set(data.map(m => m.id));
              cleaned.forEach(m => { if (!existingIds.has(m.id)) data.push(m); });
              // Ensure chronological order
              data.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
              backfillPages++;
            } catch (e) {
              if (__DEV__) console.warn('⚠️ [SLIDING] Backfill fetch failed:', e?.message || e);
              break;
            }
          }
          // Trim to sliding window size
          if (data.length > SLIDING_WINDOW_SIZE) data = data.slice(-SLIDING_WINDOW_SIZE);
        }
      }

        // Update state only if component is mounted and this is the latest operation
        if (isMountedRef.current && pendingOperationsRef.current.has(operationId)) {
          const finalData = data || [];

          // CRITICAL FIX: Ensure read status is properly initialized for loaded messages
          const processedData = finalData.map(msg => {
            // For incoming messages (not from current user), ensure proper read status
            if (msg.sender_id !== currentUserId) {
              // If message doesn't have seen status, it should be marked as unseen initially
              // The read status will be updated when the user opens the chat
              return { ...msg, seen: msg.seen || false };
            }
            // For outgoing messages, preserve the seen status from the database
            return msg;
          });

          // Performance: Only update state if data actually changed
          const currentMessages = messagesRef.current;
          const hasChanged = processedData.length !== currentMessages.length ||
            processedData.some((msg, index) => msg.id !== currentMessages[index]?.id);

          if (hasChanged) {
            setMessages(processedData);
            renderCountRef.current++;

            // CRITICAL FIX: Clear old cache when we have fresh data to prevent stale data
            if (cacheKey) {
              cacheRef.current.delete(cacheKey);
            }
          }

          setLoading(false);

          // Cache the results with a fresh timestamp
          cacheMessages(processedData);

          // Preload media for better UX when opening from notifications
          preloadMessageMedia(processedData);

          if (__DEV__) {
            console.log(`✅ [SLIDING] Loaded ${processedData.length} messages for sliding window (render #${renderCountRef.current}) - hasChanged: ${hasChanged}`);
            console.log(`📊 [SLIDING] Message types:`, processedData.map(msg => ({
              id: msg.id,
              type: msg.is_nsfw ? 'NSFW' : (msg.view_once ? 'OneTime' : 'Permanent'),
              sender: msg.sender_id === currentUserId ? 'You' : 'Other',
              viewed: msg.is_nsfw && msg.receiver_id === currentUserId ? nsfwViewService.isViewed(msg.id) : 'N/A'
            })));
          }
        }      return data || [];
    } catch (err) {
      console.error('❌ [SLIDING] Error loading messages:', err);
      if (isMountedRef.current && pendingOperationsRef.current.has(operationId)) {
        setError(err.message);
        setLoading(false);
      }
      return messagesRef.current;
    } finally {
      // Clean up both operation ID and global request key
      pendingOperationsRef.current.delete(operationId);
      pendingOperationsRef.current.delete(globalRequestKey);
    }
  }, [currentUserId, otherUserId, getCachedMessages, cacheMessages, cacheKey]);

  // Initialize messages on conversation change
  useEffect(() => {
    isMountedRef.current = true;
    
    // Reset state
    setMessages([]);
    setLoading(true);
    setError(null);
    setLastMessageId(null);
    
    // CRITICAL FIX: Add debounce for conversation changes to prevent duplicate fetches
    const initConversation = async () => {
      // Try cache first, then fetch
      const cached = getCachedMessages();
      if (cached.length > 0) {
        setMessages(cached);
        setLoading(false);
        if (__DEV__) {
          console.log(`🚀 [SLIDING] Loaded ${cached.length} messages from cache instantly`);
          console.log(`📊 [SLIDING] Cached message types:`, cached.map(msg => ({
            id: msg.id,
            type: msg.is_nsfw ? 'NSFW' : (msg.view_once ? 'OneTime' : 'Permanent'),
          })));
        }
        
        // EGRESS OPTIMIZATION: Pre-sign media URLs in batch to avoid individual storage requests
        const mediaUrls = cached
          .filter(msg => msg.media_url || msg.thumbnail_url)
          .flatMap(msg => [msg.media_url, msg.thumbnail_url].filter(Boolean));
          
        if (mediaUrls.length > 0) {
          try {
            const { getSignedUrlsBatch } = await import('../services/unifiedMediaService');
            console.log(`🎯 [SLIDING] Pre-signing ${mediaUrls.length} cached media URLs in batch`);
            await getSignedUrlsBatch(mediaUrls);
            console.log(`✅ [SLIDING] Pre-signed cached media URLs successfully`);
          } catch (error) {
            console.warn('⚠️ [SLIDING] Failed to pre-sign cached media URLs:', error);
          }
        }
        
        // If cached window is not full, backfill immediately; else do background refresh only if stale
        const isWindowFull = cached.length >= SLIDING_WINDOW_SIZE;
        const cacheAge = Date.now() - (cacheRef.current.get(cacheKey)?.timestamp || 0);
        const isStale = cacheAge > (2 * 60 * 1000); // 2 minutes

        if (!isWindowFull) {
          if (__DEV__) {
            console.log(`🔄 [SLIDING] Cached window not full (${cached.length}/${SLIDING_WINDOW_SIZE}), fetching to backfill`);
          }
          fetchMessages({ forceRefresh: true, silent: true });
        } else if (isStale) {
          if (__DEV__) {
            console.log(`🔄 [SLIDING] Cache is stale (${Math.round(cacheAge/1000)}s old), refreshing in background`);
          }
          // Use cache-respecting fetch for background sync to reduce redundant API calls
          setTimeout(() => {
            if (isMountedRef.current) {
              fetchMessages({ forceRefresh: false, silent: true });
            }
          }, 1000); // Longer delay to let UI settle
        } else {
          if (__DEV__) {
            console.log(`✅ [SLIDING] Cache is fresh (${Math.round(cacheAge/1000)}s old), skipping background refresh`);
          }
        }
      } else {
        if (__DEV__) {
          console.log(`🚀 [SLIDING] No cache available, fetching fresh messages for ${conversationId}`);
        }
        fetchMessages();
      }
    };
    
    // Debounce conversation initialization to prevent rapid-fire requests
    const debounceDelay = 100;
    const timeoutId = setTimeout(initConversation, debounceDelay);
    
    return () => {
      clearTimeout(timeoutId);
      isMountedRef.current = false;
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [conversationId, getCachedMessages, fetchMessages, cacheKey]);

  // CRITICAL FIX: Handle new messages from realtime with proper read status
  const handleNewMessage = useCallback(async (newMessage) => {
    if (!isMountedRef.current) return;

    const currentMessages = messagesRef.current;
    const messageExists = currentMessages.some(msg => msg.id === newMessage.id);

    if (messageExists) {
      if (__DEV__) {
        console.log(`⚠️ [SLIDING] Message ${newMessage.id} already exists, skipping duplicate`);
      }
      return;
    }

    // CRITICAL FIX: For incoming messages, ensure proper read status initialization
    let processedMessage = newMessage;
    if (newMessage.sender_id !== currentUserId) {
      // This is an incoming message - it should be marked as unseen initially
      processedMessage = {
        ...newMessage,
        seen: false,
        seen_at: null
      };

      // REMOVED: Automatic read marking when chat is visible
      // Let ChatScreen handle read receipts only when user actually views the message
      if (__DEV__) {
        console.log('📝 [SLIDING] New message received - will be marked as read only when user views it');
      }
    }

    // Add to messages state
    const updatedMessages = [...currentMessages, processedMessage];
    setMessages(updatedMessages);

    // Update cache
    cacheMessages(updatedMessages);

    // Preload media for the new message
    preloadMessageMedia([processedMessage]);

    if (__DEV__) {
      console.log(`📨 [SLIDING] Added new message ${newMessage.id} to sliding window`, {
        sender: newMessage.sender_id === currentUserId ? 'You' : 'Other',
        type: newMessage.is_nsfw ? 'NSFW' : (newMessage.view_once ? 'OneTime' : 'Permanent'),
        autoRead: false // Always false now since we don't auto-mark as read
      });
    }
  }, [currentUserId, otherUserId, pairId, isChatVisible, cacheMessages]);

  // Enhanced realtime updates with immediate refresh
  useEffect(() => {
    if (!conversationId) return;

    const handleRealtimeUpdate = (data, eventType) => {
      const isRelevant = (
        (data.message?.sender_id === currentUserId && data.message?.receiver_id === otherUserId) ||
        (data.message?.sender_id === otherUserId && data.message?.receiver_id === currentUserId) ||
        (data.senderId === currentUserId && data.receiverId === otherUserId) ||
        (data.senderId === otherUserId && data.receiverId === currentUserId) ||
        (data.conversationId === otherUserId) || // Added this check to catch conversation events
        (data.otherUserId === otherUserId) // Added this check for conversation updates
      );

      if (!isRelevant) {
        if (__DEV__) {
          console.log(`⏭️ [SLIDING] Skipping irrelevant update for event ${eventType}:`, {
            messageId: data.message?.id || data.messageId,
            sender: data.message?.sender_id || data.senderId,
            receiver: data.message?.receiver_id || data.receiverId,
            currentUser: currentUserId,
            otherUser: otherUserId,
            conversationId: data.conversationId
          });
        }
        return;
      }

      if (__DEV__) {
        console.log(`✅ [SLIDING] Relevant realtime update received for event ${eventType}:`, {
          messageId: data.message?.id || data.messageId,
          sender: data.message?.sender_id || data.senderId,
          receiver: data.message?.receiver_id || data.receiverId
        });
      }

      // Pair-aware read receipt handling: update local sliding window and persisted caches
      // when a 'messageRead' or 'messageReadStatusUpdated' broadcast arrives with sender/receiver pair
      if ((eventType === 'messageRead' || eventType === 'messageReadStatusUpdated') && (data.receiverId || data.senderId)) {
        try {
          const recv = data.receiverId || data.receiver_id || data.receiver;
          const snd = data.senderId || data.sender_id || data.sender;
          const seenAt = data.seenAt || data.seen_at || new Date().toISOString();
          let messageIds = data.messageIds || data.message_ids || data.ids || [];
          // Support single-id payloads
          if ((!Array.isArray(messageIds) || messageIds.length === 0) && data.messageId) {
            messageIds = [data.messageId];
          }

          // Only apply when this pair involves the current conversation participants
          const isPairRelevant = (
            (String(recv) === String(currentUserId) && String(snd) === String(otherUserId)) ||
            (String(recv) === String(otherUserId) && String(snd) === String(currentUserId))
          );

          if (isPairRelevant) {
            if (__DEV__) console.log('📣 [SLIDING] Applying pair-based seen update for sliding window', { recv, snd, messageIds });

            // Update in-memory optimistic store
            try { chatStore.markMessageIdsAsSeenPair(messageIds, recv, snd, seenAt); } catch (_e) {}

            // Update persisted AsyncStorage caches for this pair
            try { messagesCache.setSeenForPair(currentUserId, otherUserId, messageIds, seenAt); } catch (_e) {}

            // Update in-memory sliding window messages if they match
            let anyUpdated = false;
            if (Array.isArray(messageIds) && messageIds.length > 0) {
              setMessages(prev => prev.map(m => {
                if (m && messageIds.includes(m.id)) {
                  anyUpdated = true;
                  return { ...m, seen: true, seen_at: seenAt };
                }
                return m;
              }));

              // Keep local cacheRef in sync to avoid stale rehydration flipping UI
              try {
                if (cacheKey) {
                  const cached = cacheRef.current.get(cacheKey);
                  if (cached && Array.isArray(cached.data)) {
                    const updated = cached.data.map(m => (m && messageIds.includes(m.id)) ? { ...m, seen: true, seen_at: seenAt } : m);
                    cacheRef.current.set(cacheKey, { data: updated, timestamp: cached.timestamp });
                  }
                }
              } catch (_) {}
            } else {
              // If no explicit ids were provided, mark messages sent by snd to recv up to cutoff
              if (data.seenAt || data.before) {
                const cutoff = data.seenAt || data.before || data.seen_at;
                const cutoffTs = Date.parse(cutoff);
                setMessages(prev => prev.map(m => {
                  if (m && Date.parse(m.created_at) <= cutoffTs && m.receiver_id === recv && m.sender_id === snd) {
                    anyUpdated = true;
                    return { ...m, seen: true, seen_at: seenAt };
                  }
                  return m;
                }));
                try { messagesCache.markUntilTimestampAsSeenPair(recv, snd, cutoff); } catch (_e) {}
                try { chatStore.markUntilTimestampAsSeenPair({ receiverId: recv, senderId: snd, beforeISO: cutoff }); } catch (_e) {}

                // Also update local cacheRef for cutoff-based updates
                try {
                  if (cacheKey) {
                    const cached = cacheRef.current.get(cacheKey);
                    if (cached && Array.isArray(cached.data)) {
                      const updated = cached.data.map(m => {
                        try {
                          if (!m) return m;
                          if (Date.parse(m.created_at) <= cutoffTs && m.receiver_id === recv && m.sender_id === snd) {
                            return { ...m, seen: true, seen_at: seenAt };
                          }
                        } catch (_) {}
                        return m;
                      });
                      cacheRef.current.set(cacheKey, { data: updated, timestamp: cached.timestamp });
                    }
                  }
                } catch (_) {}
              }
            }

            // Force a re-render of combinedMessages when read status changes
            if (anyUpdated) {
              setOptimisticUpdateCounter(prev => prev + 1);
            }

            // No further invalidation required for pure read updates
            if (__DEV__) console.log('✅ [SLIDING] Applied optimistic read update for sliding window');
          }
        } catch (err) {
          if (__DEV__) console.warn('⚠️ [SLIDING] Failed to apply pair-based read update:', err);
        }
      }

      const eventKey = `${eventType}_${data?.message?.id || data?.messageId || Date.now()}`;
      if (pendingOperationsRef.current.has(eventKey)) {
        return;
      }

      pendingOperationsRef.current.add(eventKey);
      
      // Immediate optimization for responsiveness
      if ((eventType === 'messageReceived' || eventType === 'messageSent') && data.message) {
        // Force an immediate re-render for better real-time feel
        setOptimisticUpdateCounter(prev => prev + 1);
        
        // Also trigger a state update to force re-computation of getCachedMessages
        setLastMessageId(data.message.id);
      }
      
      setTimeout(() => {
        pendingOperationsRef.current.delete(eventKey);
      }, 1000);

      if (__DEV__) {
        console.log(`🔄 [SLIDING] Realtime update: ${eventType}`, data);
      }

      // EGRESS OPTIMIZATION: Don't immediately clear cache for all events
      // Only clear cache for events that actually change message content/order
      const cacheInvalidatingEvents = ['messageReceived', 'messageSent', 'messageDeleted'];
      const shouldInvalidateCache = cacheInvalidatingEvents.includes(eventType);
      
      if (shouldInvalidateCache) {
        // Clear local cache to ensure fresh data
        if (cacheKey) {
          cacheRef.current.delete(cacheKey);
        }
        
        // CRITICAL FIX: Only clear apiManager cache for events that require fresh data
        // Read status updates don't require message refetch
        if (eventType === 'messageReceived' || eventType === 'messageSent') {
          // Instead of clearing the apiManager cache (which drops history needed
          // by the sliding window), perform a targeted in-place cache update
          // so we preserve existing messages and only append/replace the new one.
          try {
            const raw = data?.message ?? data;
            // Only treat as a real message if it has the required shape
            if (isValidMessage(raw)) {
              const otherId = (raw.sender_id === currentUserId) ? raw.receiver_id : raw.sender_id;
              if (otherId && typeof realtimeCacheManager.updateMessageCacheWithNewMessage === 'function') {
                realtimeCacheManager.updateMessageCacheWithNewMessage(raw, otherId);
                if (__DEV__) console.log(`📌 [SLIDING] Performed in-place cache update for new message ${raw.id}`);
              } else if (__DEV__) {
                console.log('⚠️ [SLIDING] Skipping in-place update: missing otherId or updater function');
              }
            } else if (__DEV__) {
              // Guard against system/read-status events arriving on messageReceived
              console.log('⚠️ [SLIDING] Skipping in-place update for non-message payload on messageReceived/messageSent');
            }
          } catch (err) {
            console.warn('⚠️ [SLIDING] Failed to perform in-place cache update, falling back to invalidation:', err);
            // Fallback to invalidation to avoid stale UI
            const cacheKeys = [
              `messages_currentUserId:${currentUserId}|otherUserId:${otherUserId}`,
              `messages_currentUserId:${otherUserId}|otherUserId:${currentUserId}`
            ];
            cacheKeys.forEach(key => apiManager.invalidateCache(key));
          }
        } else {
          if (__DEV__) {
            console.log(`✅ [SLIDING] Skipped cache invalidation for ${eventType} (not required)`);
          }
        }
      } else {
        if (__DEV__) {
          console.log(`✅ [SLIDING] Skipped cache invalidation for ${eventType} (read-only update)`);
        }
      }

      // Faster response time for real-time events with minimal debounce
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }

      // Prioritize message events for faster processing
      // Enhanced debounce timing based on event type for optimal responsiveness
      const delayTime = (eventType === 'messageReceived' || eventType === 'messageSent') ? 50 : 
                       (eventType === 'messageRead') ? READ_RECEIPT_DEBOUNCE : DEBOUNCE_TIME;

      debounceTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          // For new messages, use the dedicated handler for better read status management
          if (eventType === 'messageReceived' || eventType === 'messageSent') {
            const newMessage = data.message || data;
            if (isValidMessage(newMessage)) {
              // Use the dedicated handler which includes proper read status logic
              handleNewMessage(newMessage);
            }
          }
          // For read-status updates (including NSFW completion), update local NSFW state immediately
          if (eventType === 'messageRead' || eventType === 'messageReadStatusUpdated') {
            try {
              const mid = data?.messageId || data?.message?.id;
              const isNsfw = data?.isNsfw === true;
              
              console.log(`📡 [SLIDING] Received read status update:`, {
                eventType,
                messageId: mid,
                isNsfw,
                currentUserId,
                otherUserId
              });
              
              if (mid && isNsfw) {
                // Mark NSFW as viewed locally so filters hide it immediately
                console.log(`🔄 [SLIDING] Marking NSFW message as viewed via realtime: ${mid}`);
                nsfwViewService.markAsViewed(mid).catch(() => {});
                // Remove the viewed NSFW message from the in-memory window right away
                setMessages(prev => Array.isArray(prev) ? prev.filter(m => !(m && m.id === mid && m.is_nsfw)) : prev);
                // Also clean it from pair caches on both directions to avoid re-hydrating it
                try {
                  const keyAB = `messages_currentUserId:${currentUserId}|otherUserId:${otherUserId}`;
                  const keyBA = `messages_currentUserId:${otherUserId}|otherUserId:${currentUserId}`;
                  [keyAB, keyBA].forEach(k => {
                    try {
                      const cached = apiManager.getFromCache(k);
                      if (Array.isArray(cached) && cached.length) {
                        const cleaned = cached.filter(m => !(m && m.id === mid && m.is_nsfw));
                        if (cleaned.length !== cached.length) {
                          apiManager.setCache(k, cleaned);
                        }
                      }
                    } catch (_) {}
                  });
                } catch (_) {}
              }
            } catch (_) {}
          }
          
          // Always refresh after a short delay to ensure consistency
          setTimeout(() => {
            if (isMountedRef.current) {
              fetchMessages({ silent: true });
            }
          }, 200); // Reduced delay for better responsiveness
        }
      }, delayTime); // Use dynamic delay time based on event type
    };

    // Register for realtime events
  const eventTypes = ['messageReceived', 'messageSent', 'messageReadStatusUpdated', 'messageRead', 'messageDeleted'];
  const unsubscribers = [];

    eventTypes.forEach(eventType => {
      const unsubscribe = realtimeCacheManager.on(eventType, (data) => {
        handleRealtimeUpdate(data, eventType);
      });
      unsubscribers.push(unsubscribe);
    });

    return () => {
      unsubscribers.forEach(unsub => unsub());
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [conversationId, currentUserId, otherUserId, fetchMessages, cacheMessages, cacheKey, handleNewMessage]);

  // Listen for optimistic message changes to trigger re-renders and cache invalidation - ENHANCED
  useEffect(() => {
    const handleOptimisticUpdate = (data) => {
      console.log('🔄 [SLIDING] Optimistic update received:', data);
      
      // Use different debounce timing based on update type
      const isReadReceipt = data?.type === 'messageRead' || data?.status === 'read';
      const debounceDelay = isReadReceipt ? READ_RECEIPT_DEBOUNCE : DEBOUNCE_TIME;
      
      // Debounce updates to prevent rapid flickering during message transitions
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      
      debounceTimeoutRef.current = setTimeout(() => {
        setOptimisticUpdateCounter(prev => prev + 1);
      }, debounceDelay);
    };

    const handleOptimisticReplaced = (data) => {
      const { tempId, realMessage } = data || {};
      if (!tempId || !realMessage) {
        setOptimisticUpdateCounter(prev => prev + 1);
        return;
      }

      // Immediate in-memory replacement to avoid duplicates
      setMessages(prevMessages => {
        if (!Array.isArray(prevMessages) || prevMessages.length === 0) {
          setOptimisticUpdateCounter(prev => prev + 1);
          return prevMessages;
        }

        let updated = [...prevMessages];
        let replacementMade = false;

        // Find the optimistic message to replace
        const optimisticIndex = updated.findIndex(m => 
          m && (
            m.id === tempId || 
            m._tempId === tempId || 
            m.tempId === tempId ||
            // For messages without stable IDs, match by content and timing
            (m._isSending && !m.id && 
             m.sender_id === realMessage.sender_id && 
             m.receiver_id === realMessage.receiver_id &&
             Math.abs(new Date(m.created_at) - new Date(realMessage.created_at)) < 5000)
          )
        );

        if (optimisticIndex >= 0) {
          // Replace optimistic message with real message at the same position
          updated[optimisticIndex] = {
            ...realMessage,
            _tempId: tempId,
            _isOptimisticReplacement: true
          };
          replacementMade = true;
        } else {
          // If optimistic message not found, check if real message already exists
          const realExists = updated.some(m => m && m.id === realMessage.id);
          if (!realExists) {
            // Add real message in chronological order
            const realTime = new Date(realMessage.created_at).getTime();
            let insertIndex = updated.length;
            
            for (let i = updated.length - 1; i >= 0; i--) {
              const msgTime = new Date(updated[i].created_at).getTime();
              if (msgTime <= realTime) {
                insertIndex = i + 1;
                break;
              }
            }
            
            updated.splice(insertIndex, 0, {
              ...realMessage,
              _tempId: tempId,
              _isOptimisticReplacement: true
            });
            replacementMade = true;
          }
        }

        if (!replacementMade) {
          setOptimisticUpdateCounter(prev => prev + 1);
          return prevMessages;
        }

        // Enhanced normalization: filter invalid messages and sort chronologically
        updated = updated.filter(isValidMessage);
        updated.sort((a, b) => {
          const timeA = new Date(a.created_at).getTime();
          const timeB = new Date(b.created_at).getTime();
          // If times are very close, prioritize real messages over optimistic ones
          if (Math.abs(timeA - timeB) < 1000) {
            const aIsOptimistic = !!(a._isSending);
            const bIsOptimistic = !!(b._isSending);
            if (aIsOptimistic !== bIsOptimistic) {
              return aIsOptimistic ? 1 : -1; // Real messages first
            }
          }
          return timeA - timeB;
        });

        // Apply enhanced deduplication
        updated = dedupeMessages(updated);

        // Maintain sliding window while ensuring optimistic messages stay visible
        const optimisticCount = updated.filter(m => m._isSending).length;
        let slidingWindow;
        
        if (optimisticCount > 0) {
          // Expand window to accommodate optimistic messages
          const windowSize = Math.max(SLIDING_WINDOW_SIZE, optimisticCount + SLIDING_WINDOW_SIZE - 1);
          slidingWindow = updated.slice(-windowSize);
        } else {
          slidingWindow = updated.slice(-SLIDING_WINDOW_SIZE);
        }

        // Update local cache to maintain consistency
        cacheMessages(slidingWindow);

        console.log(`🔄 [SLIDING] Optimistic replacement complete: ${prevMessages.length} -> ${slidingWindow.length} messages`);
        return slidingWindow;
      });
    };

    backgroundMessageService.on('optimisticMessageAdded', handleOptimisticUpdate);
    backgroundMessageService.on('messageStatusUpdate', handleOptimisticUpdate);
    backgroundMessageService.on('optimisticMessageReplaced', handleOptimisticReplaced);
    backgroundMessageService.on('messageCancelled', handleOptimisticUpdate);
    backgroundMessageService.on('messageCleanup', handleOptimisticUpdate); // Listen for cleanup events

    // CRITICAL FIX: Also listen to realtimeCacheManager events for optimistic messages
    realtimeCacheManager.on('optimisticMessageReplaced', handleOptimisticReplaced);

    return () => {
      backgroundMessageService.off('optimisticMessageAdded', handleOptimisticUpdate);
      backgroundMessageService.off('messageStatusUpdate', handleOptimisticUpdate);
      backgroundMessageService.off('optimisticMessageReplaced', handleOptimisticReplaced);
      backgroundMessageService.off('messageCancelled', handleOptimisticUpdate);
      backgroundMessageService.off('messageCleanup', handleOptimisticUpdate);
      realtimeCacheManager.off('optimisticMessageReplaced', handleOptimisticReplaced);
    };
  }, [cacheKey, currentUserId, otherUserId, fetchMessages, cacheMessages]);

  // Pair-specific pending optimistic signature to force recompute even if base messages unchanged
  const pendingSignature = useMemo(() => {
    try {
      const arr = backgroundMessageService
        .getAllPendingMessages()
        .filter(msg => 
          (msg.sender_id === currentUserId && msg.receiver_id === otherUserId) ||
          (msg.sender_id === otherUserId && msg.receiver_id === currentUserId)
        );
      // Build a light signature: count + last id
      if (!arr || arr.length === 0) return '0';
      const last = arr[arr.length - 1];
      return `${arr.length}:${last?.id || last?._tempId || 'none'}`;
    } catch (_) {
      return '0';
    }
  }, [currentUserId, otherUserId, optimisticUpdateCounter]);

  // Combine with optimistic messages from background service
  const combinedMessages = useMemo(() => {
    if (!currentUserId || !otherUserId) return [];

    // Filter out invalid messages from the base messages array
    const validMessages = messages.filter(isValidMessage);

    // Get pending optimistic messages for this conversation
    const pendingMessages = backgroundMessageService.getAllPendingMessages()
      .filter(msg => 
        (msg.sender_id === currentUserId && msg.receiver_id === otherUserId) ||
        (msg.sender_id === otherUserId && msg.receiver_id === currentUserId)
      )
      .filter(isValidMessage)
      .filter(msg => msg._isSending); // Only include actively sending messages

    // Simple deduplication: remove optimistic messages that have real counterparts
    const realMessageIds = new Set(validMessages.map(m => m.id).filter(Boolean));
    const realMessageTempIds = new Set();
    
    validMessages.forEach(msg => {
      if (msg._tempId) realMessageTempIds.add(msg._tempId);
      if (msg.tempId) realMessageTempIds.add(msg.tempId);
    });

    // Filter optimistic messages that haven't been replaced yet
    const uniquePendingMessages = pendingMessages.filter(msg => {
      // Remove if real message with same ID exists
      if (msg.id && realMessageIds.has(msg.id)) return false;
      
      // Remove if real message with same tempId exists (replacement case)
      const msgTempId = msg.tempId || msg._tempId;
      if (msgTempId && realMessageTempIds.has(msgTempId)) return false;
      
      return true;
    });

    // Combine all messages
    const combined = [...validMessages, ...uniquePendingMessages];
    
    // Sort chronologically
    combined.sort((a, b) => {
      const timeA = new Date(a.created_at).getTime();
      const timeB = new Date(b.created_at).getTime();
      
      // For messages at same time, prefer real over optimistic
      if (Math.abs(timeA - timeB) < 1000) {
        const aIsOptimistic = !!(a._isSending);
        const bIsOptimistic = !!(b._isSending);
        
        if (aIsOptimistic !== bIsOptimistic) {
          return aIsOptimistic ? 1 : -1;
        }
      }
      
      return timeA - timeB;
    });

    // Apply read status from chatStore
    try {
      combined.forEach(message => {
        if (message && !message.seen) {
          const conversationKeys = Object.keys(chatStore);
          for (const key of conversationKeys) {
            const storedMessages = chatStore[key];
            if (Array.isArray(storedMessages)) {
              const storedMessage = storedMessages.find(m => m.id === message.id);
              if (storedMessage && storedMessage.seen) {
                message.seen = true;
                message.seen_at = storedMessage.seen_at;
                break;
              }
            }
          }
        }
      });
    } catch (e) {
      // Ignore chatStore errors
    }

    // Filter NSFW messages based on view status
    const filtered = combined.filter(message => {
      if (message._isSending) return true;
      if (!message.is_nsfw) return true;
      return !nsfwViewService.isViewed(message.id);
    });
    
    // Final deduplication
    const dedupedFiltered = dedupeMessages(filtered);
    
    // Apply sliding window with optimistic message accommodation
    let slidingWindow;
    const optimisticCount = dedupedFiltered.filter(m => m._isSending).length;
    
    if (optimisticCount > 0) {
      const windowSize = Math.max(SLIDING_WINDOW_SIZE, optimisticCount + SLIDING_WINDOW_SIZE - 1);
      slidingWindow = dedupedFiltered.slice(-windowSize);
    } else {
      slidingWindow = dedupedFiltered.slice(-SLIDING_WINDOW_SIZE);
    }

    return slidingWindow;
  }, [messages, currentUserId, otherUserId, pendingSignature]);

  // Optimized API methods
  const refresh = useCallback((options = {}) => {
    // Default to forceRefresh: true for backward compatibility, but allow override
    const { forceRefresh = true, ...otherOptions } = options;
    return fetchMessages({ forceRefresh, ...otherOptions });
  }, [fetchMessages]);

  const sendMessage = useCallback(async (content, mediaType = 'text') => {
    if (!currentUserId || !otherUserId || !content) {
      throw new Error('Missing required parameters for sending message');
    }
    
    if (__DEV__) {
      console.log('📤 [SLIDING] Sending message via background service:', { 
        content: typeof content === 'string' ? content.substring(0, 50) : 'media', 
        mediaType, 
        currentUserId, 
        otherUserId 
      });
    }
    
    try {
      // Use the background service which handles optimistic updates automatically
      const result = await backgroundMessageService.sendMessage(
        currentUserId,
        otherUserId,
        content,
        mediaType
      );
      
      if (__DEV__) {
        console.log('✅ [SLIDING] Message sent via background service:', result?.id || 'pending');
      }
      
      // Force immediate UI update to show optimistic message
      setOptimisticUpdateCounter(prev => prev + 1);
      
      // The background service handles optimistic messages automatically
      // Clear cache after a short delay to ensure real message replaces optimistic one
      if (result) {
        setTimeout(() => {
          if (isMountedRef.current) {
            // Clear cache to get fresh data with the real message
            if (cacheKey) {
              cacheRef.current.delete(cacheKey);
            }
            // Silent refresh to replace optimistic with real message
            fetchMessages({ silent: true, forceRefresh: false });
          }
        }, 2000); // Increased delay to allow for better UX
      }
      
      return result;
    } catch (err) {
      console.error('❌ [SLIDING] Error sending message:', err);
      // Force UI update to reflect failed state
      setOptimisticUpdateCounter(prev => prev + 1);
      throw err;
    }
  }, [currentUserId, otherUserId, fetchMessages, cacheKey]);

  const markAsRead = useCallback(async (messageId) => {
    if (!messageId) return;
    
    try {
      await apiManager.markMessageAsRead(messageId, currentUserId);
      
      // Update local state optimistically
      setMessages(prev => prev.map(msg => 
        msg.id === messageId ? { ...msg, seen: true } : msg
      ));
    } catch (err) {
      console.error('❌ [SLIDING] Error marking message as read:', err);
    }
  }, [currentUserId]);

  const removeNsfwMessage = useCallback((messageId) => {
    if (!messageId) return;
    
    console.log(`🗑️ [REMOVE] Removing NSFW message ${messageId} from sliding window`)
    
    // Check current messages before removal
    setMessages(currentMessages => {
      const messageExists = currentMessages.some(msg => msg.id === messageId);
      console.log(`🔍 [REMOVE] Message ${messageId} exists in current messages: ${messageExists}`);
      
      if (!messageExists) {
        console.log(`⚠️ [REMOVE] Message ${messageId} not found in current messages, nothing to remove`);
        return currentMessages;
      }
      
      const beforeCount = currentMessages.length
      const updated = currentMessages.filter(msg => msg.id !== messageId);
      const afterCount = updated.length
      console.log(`🗑️ [REMOVE] Messages before: ${beforeCount}, after: ${afterCount}, removed: ${beforeCount - afterCount}`)
      
      if (beforeCount !== afterCount) {
        console.log(`✅ [REMOVE] Successfully removed message ${messageId} from UI`)
        cacheMessages(updated);
      } else {
        console.log(`❌ [REMOVE] Failed to remove message ${messageId} from messages array`)
      }
      
      // UX: Do not trigger immediate fetch or refresh to avoid flicker.
      // Backfill will happen via normal flow (cache/resume/realtime) if needed.
      return updated;
    });
    
    // Verify removal after a short delay
    setTimeout(() => {
      setMessages(currentMessages => {
        const stillExists = currentMessages.some(msg => msg.id === messageId);
        if (stillExists) {
          console.log(`⚠️ [REMOVE] Message ${messageId} still exists in messages after removal attempt!`);
          // Force remove it again
          const cleaned = currentMessages.filter(msg => msg.id !== messageId);
          if (cleaned.length !== currentMessages.length) {
            console.log(`🔧 [REMOVE] Force removing message ${messageId} again`);
            cacheMessages(cleaned);
            return cleaned;
          }
        } else {
          console.log(`✅ [REMOVE] Message ${messageId} successfully removed and not re-added`);
        }
        return currentMessages;
      });
    }, 100);
  }, [cacheMessages, fetchMessages]);

  // Enhanced return API with additional validation
  const safeMessages = useMemo(() => {
    return combinedMessages.filter(isValidMessage);
  }, [combinedMessages]);

  return {
    messages: safeMessages,
    loading,
    error,
    refresh,
    sendMessage,
    markAsRead,
    removeNsfwMessage,
    // Additional sliding window specific properties
    windowSize: SLIDING_WINDOW_SIZE,
    isWindowFull: safeMessages.length >= SLIDING_WINDOW_SIZE,
    lastMessageId: safeMessages.length > 0 ? safeMessages[safeMessages.length - 1]?.id : lastMessageId
  };
};

export { useSlidingWindowMessages };
