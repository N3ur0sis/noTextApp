/**
 * Production Conversations Hook - Memory Optimized
 * High-performance, batched realtime up      if (__DEV__) {
        console.log(`📊 [CONVERSATIONS] Fetched ${data.length} conversations (NSFW filtering handled by database) for user ${userId}`);
        if (filteredData.length > 0) {
          console.log(`🔍 [CONVERSATIONS] Sample conversation:`, {
            id: filteredData[0].id,
            has_new_message: filteredData[0].has_new_message,
            otherUser: filteredData[0].otherUser?.pseudo,
            last_message: filteredData[0].last_message?.created_at
          });
        }
      }optimistic UI
 * Smart diffing to minimize renders and resource usage
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { apiManager } from '../services/apiManager';
import { realtimeCacheManager } from '../services/realtimeCacheManager';

// Performance optimization constants
const MIN_FETCH_INTERVAL = 60000;     // EGRESS OPTIMIZATION: Increased to 60 seconds to reduce API calls by 50%  
const BATCH_DEBOUNCE_TIME = 2000;     // EGRESS OPTIMIZATION: Increased to 2 seconds for better batching
// PATCH 8: Disable background polling in production, keep for dev
const BACKGROUND_REFRESH_INTERVAL = __DEV__ ? 120000 : 0; // 2 minutes in dev, disabled in production

const useSimpleConversations = (userId) => {
  console.log('🟠 [TRACE] useSimpleConversations called', { userId });
  // State with optimization flags
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshToken, setRefreshToken] = useState(Date.now()) // For FlatList optimization
  console.log('🟠 [TRACE] useSimpleConversations state', { conversations, loading, error, refreshToken });
  
  // Performance tracking refs
  const lastFetchRef = useRef(0);
  const debounceTimeoutRef = useRef(null);
  const backgroundRefreshRef = useRef(null);
  const isMountedRef = useRef(true);
  const pendingUpdatesRef = useRef(new Map());
  const appStateRef = useRef(AppState.currentState);
  const initialLoadCompletedRef = useRef(false);
  const activeRequestRef = useRef(null); // P2 FIX: Prevent concurrent API calls
  
  // Create stable refs for functions to prevent stale closures
  const fetchConversationsRef = useRef(null);
  const processPendingUpdatesRef = useRef(null);
  
  // Tracking metrics for performance optimization
  const metricsRef = useRef({
    fetchCount: 0,
    eventCount: 0,
    lastRenderTime: 0
  });
  
  // Smart diffing helper for conversations
  const getConversationSignature = useCallback((conversations) => {
    if (!conversations || !conversations.length) return '';
    // Generate a fast signature based on IDs, last_message timestamps, read status, and seen status
    return conversations
      .slice(0, 10) // Only check first 10 for performance
      .map(c => `${c.id}:${c.last_message?.created_at || ''}:${c.unread_count || 0}:${c.seen || false}:${c.has_new_message || false}`)
      .join('|');
  }, []);
  
  // Enhanced fetch with pagination, smart-diffing and background optimization
  const fetchConversations = useCallback(async (options = {}) => {
    console.log('🟠 [TRACE] fetchConversations', { options });
    const { 
      forceRefresh = false,
      background = false,
      silent = false
    } = options;
    
    // Early return if no user ID or component unmounted
    if (!userId || !isMountedRef.current) {
      return conversations;
    }

    // P2 FIX: Return existing request if one is in progress
    if (activeRequestRef.current && !forceRefresh) {
      if (__DEV__) console.log(`⏭️ [CONVERSATIONS] Using active request in progress`)
      return await activeRequestRef.current;
    }

    // Skip if requesting too frequently, unless forced
    const now = Date.now();
    if (!forceRefresh && now - lastFetchRef.current < MIN_FETCH_INTERVAL) {
      if (__DEV__) console.log(`⏭️ [CONVERSATIONS] Throttled (${now - lastFetchRef.current}ms)`);
      return conversations;
    }
    
    // Don't update loading state for background or silent refreshes
    if (isMountedRef.current && !silent && !background) {
      if (conversations.length === 0) {
        setLoading(true);
      }
      setError(null);
    }
    
    lastFetchRef.current = now;
    metricsRef.current.fetchCount++;
    
    // P2 FIX: Create and store active request promise to prevent duplicates
    if (!activeRequestRef.current) {
      activeRequestRef.current = (async () => {
        try {
          const data = forceRefresh 
            ? await apiManager.refreshConversations(userId)
            : await apiManager.getConversations(userId);
          
          // No client-side NSFW filtering needed - handled by database
          let filteredData = data;
          
          if (__DEV__) {
            console.log(`📊 [CONVERSATIONS] Fetched ${data.length} conversations for user ${userId}`);
            if (filteredData.length > 0) {
              console.log(`🔍 [CONVERSATIONS] Sample conversation:`, {
                id: filteredData[0].id,
                has_new_message: filteredData[0].has_new_message,
                otherUser: filteredData[0].otherUser?.pseudo,
                last_message: filteredData[0].last_message?.created_at
              });
            }
          }
          
          // Normalize server-provided seen semantics and add small safety defaults
          // Keep server truth as the source of truth for `seen`. Fallback to last_message.seen
          // if the server didn't include an explicit boolean. Do NOT flip seen based on
          // whether the current user is the sender — that was causing false false->true toggles.
          const normalizedData = (filteredData || []).map(c => {
            const lm = c.last_message || {};
            const seen = typeof c.seen === 'boolean' ? c.seen : Boolean(lm.seen);

            return {
              ...c,
              seen,
              // Preserve any explicit flags if the server provides them; otherwise keep sensible defaults
              seen_by_other: typeof c.seen_by_other === 'boolean' ? c.seen_by_other : false,
              seen_by_me: typeof c.seen_by_me === 'boolean' ? c.seen_by_me : false,
              unread_count: Number.isFinite(c.unread_count) ? c.unread_count : 0,
              has_new_message: Boolean(c.has_new_message) && (c.unread_count ?? 0) > 0
            };
          });
          // Smart diffing to avoid unnecessary re-renders
          const currentSignature = getConversationSignature(conversations);
          const newSignature = getConversationSignature(normalizedData);
          const hasChanges = currentSignature !== newSignature;
        
          // Only update UI if there are actual changes and component is mounted
          if (isMountedRef.current && (hasChanges || conversations.length === 0)) {
            // Apply stable sorting to minimize re-rendering
            const sortedData = [...normalizedData].sort((a, b) => {
              // Sort by last message date (newest first)
              const dateA = a.last_message?.created_at ? new Date(a.last_message.created_at) : new Date(0);
              const dateB = b.last_message?.created_at ? new Date(b.last_message.created_at) : new Date(0);
              return dateB - dateA;
            });
            
            setConversations(sortedData);
            // Only update refresh token if not in background to minimize renders
            if (!background) setRefreshToken(now);
            
            if (__DEV__) {
              console.log(`✅ [CONVERSATIONS] Updated ${filteredData.length} conversations`);
            }
          } else if (__DEV__ && !background) {
            console.log(`⏭️ [CONVERSATIONS] No changes detected in ${filteredData.length} conversations`);
          }
          
          // Mark initial load as completed for optimization purposes
          initialLoadCompletedRef.current = true;
          
            return normalizedData;
        } catch (err) {
          console.error('❌ [CONVERSATIONS] Error:', err);
          
          // Only set error state for critical errors, not transient network issues
          const isNetworkError = err.message?.includes('Network request failed') || err.message?.includes('network')
          if (isMountedRef.current && !silent && !background && !isNetworkError) {
            setError(err);
          } else if (isNetworkError) {
            console.log('🌐 [CONVERSATIONS] Network error detected - will retry automatically');
          }
          return conversations;
        } finally {
          if (isMountedRef.current && !silent && !background) {
            setLoading(false);
            metricsRef.current.lastRenderTime = Date.now();
          }
          // Clear active request when done
          activeRequestRef.current = null;
        }
      })();
    }
    
    return await activeRequestRef.current;
  }, [userId, conversations, getConversationSignature]);

  // Update ref after function creation
  fetchConversationsRef.current = fetchConversations;

  // Optimized batched update handler for improved performance
  const processPendingUpdates = useCallback(() => {
    const pendingUpdates = pendingUpdatesRef.current;
    if (pendingUpdates.size === 0) return;
    
    if (__DEV__) {
      console.log(`🔄 [CONVERSATIONS] Processing ${pendingUpdates.size} batched updates`);
      // Show which event types are being processed
      const eventTypes = Array.from(pendingUpdates.keys());
      console.log(`📋 [CONVERSATIONS] Event types:`, eventTypes);
    }
    
    // Find highest priority update to determine refresh strategy
    let requiresImmediateRefresh = false;
    let hasPriorityUpdates = false;
    
    const highPriorityEvents = new Set([
      'messageReceived', 
      'messageSent', 
      'conversationUpdate',
      'conversationListUpdated',
      'messageRead',
      'messageReadStatusUpdated',
      'readStatusUpdate'
    ]);
    
    pendingUpdates.forEach((data, eventType) => {
      if (highPriorityEvents.has(eventType)) {
        hasPriorityUpdates = true;
        
        // Check if update is for current user's conversation
        const isDirectlyRelevant = (data?.message && 
          (data.message.sender_id === userId || data.message.receiver_id === userId)) ||
          // Also check for read status events
          ((eventType === 'messageRead' || eventType === 'messageReadStatusUpdated' || eventType === 'readStatusUpdate') &&
          (data.senderId === userId || data.receiverId === userId)) ||
          // Handle conversationUpdate events - always relevant
          (eventType === 'conversationUpdate');
          
        if (isDirectlyRelevant) {
          requiresImmediateRefresh = true;
        }
      }
    });
    
    // Clear the pending updates map
    pendingUpdatesRef.current.clear();
    
    // Apply the appropriate refresh strategy using ref
    const fetchFn = fetchConversationsRef.current;
    if (fetchFn) {
      if (requiresImmediateRefresh) {
        if (__DEV__) {
          console.log(`⚡ [CONVERSATIONS] Immediate refresh triggered by high-priority events`);
        }
        fetchFn({ forceRefresh: true });
      } else if (hasPriorityUpdates) {
        if (__DEV__) {
          console.log(`🔄 [CONVERSATIONS] Silent refresh triggered by priority events`);
        }
        fetchFn({ forceRefresh: true, silent: true });
      } else {
        if (__DEV__) {
          console.log(`🔄 [CONVERSATIONS] Background refresh triggered by low-priority events`);
        }
        // For low priority updates, use background refresh
        fetchFn({ forceRefresh: true, background: true, silent: true });
      }
    }
  }, [userId]); // Only depend on userId

  // Update ref after function creation
  processPendingUpdatesRef.current = processPendingUpdates;
  
  // Create optimized event handler that batches updates
  const batchedUpdateHandler = useCallback((eventType, data) => {
    if (!userId || !isMountedRef.current) return;
    
    metricsRef.current.eventCount++;
    
    if (__DEV__) {
      console.log(`🎓 [CONVERSATIONS] Event: ${eventType}`);
    }
    
    // Handle conversationUpdate events
    if (eventType === 'conversationUpdate') {
      const isReadType = data?.type === 'message_read' || data?.type === 'message_seen' || data?.updateType === 'read_status';
      if (isReadType) {
        // Let the unified read-status handler below do an optimistic in-place update first
        if (__DEV__) console.log('⚡ [CONVERSATIONS] conversationUpdate is read-related; applying optimistic update before refresh');
        // Do not return; fall through to the consolidated read-status branch
      } else {
        if (__DEV__) {
          console.log(`⚡ [CONVERSATIONS] Processing non-read conversationUpdate immediately`);
          console.log(`📊 [CONVERSATIONS] Current conversation count: ${conversations.length}`);
          console.log(`👤 [CONVERSATIONS] Current user ID: ${userId}`);
        }
        // Force refresh with cache invalidation for non-read updates
        const fetchFn = fetchConversationsRef.current;
        if (fetchFn) {
          fetchFn({ forceRefresh: true, silent: false });
        }
        return;
      }
    }
    
    // Store the latest update of each type
    pendingUpdatesRef.current.set(eventType, data);
    
    // Cancel any existing timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    
    // Apply optimistic UI updates IMMEDIATELY for real-time feel
    let hasOptimisticUpdate = false;
    if ((eventType === 'messageReceived' || eventType === 'messageSent') && data?.message) {
      hasOptimisticUpdate = true;
      // Optimistically update conversation with new message
      setConversations(prevConversations => {
        // Find if this message belongs to an existing conversation
        const messageData = data.message;
        const otherUserId = messageData.sender_id === userId 
          ? messageData.receiver_id 
          : messageData.sender_id;
          
        if (__DEV__) {
          console.log('📨 [CONVERSATIONS] Processing new message optimistically:', {
            messageId: messageData.id,
            senderId: messageData.sender_id,
            receiverId: messageData.receiver_id,
            otherUserId,
            currentUserId: userId,
            existingConversations: prevConversations.map(c => ({
              id: c.id,
              otherUserId: c.otherUser?.id,
              other_user_id: c.other_user_id,
              sender_id: c.sender_id,
              receiver_id: c.receiver_id,
              contact_id: c.contact_id
            }))
          });
        }
          
        const conversationIndex = prevConversations.findIndex(c => {
          // Try multiple matching strategies based on the actual conversation structure
          const otherUserMatches = (c.otherUser?.id === otherUserId) ||
                                  (c.other_user_id === otherUserId) ||
                                  (c.contact_id === otherUserId) ||
                                  (c.id === otherUserId);
          
          const senderReceiverMatches = (c.sender_id === messageData.sender_id && c.receiver_id === messageData.receiver_id) ||
                                       (c.sender_id === messageData.receiver_id && c.receiver_id === messageData.sender_id);
          
          const matches = otherUserMatches || senderReceiverMatches;
          
          if (__DEV__ && matches) {
            console.log('✅ [CONVERSATIONS] Found matching conversation:', {
              conversationId: c.id,
              otherUserId: c.otherUser?.id || c.other_user_id || c.contact_id,
              matchedBy: otherUserMatches ? 'otherUser' : 'sender_receiver'
            });
          }
          
          return matches;
        });
        
        if (conversationIndex >= 0) {
          const updatedConversations = [...prevConversations];
          const conversation = updatedConversations[conversationIndex];
          
          // Create updated conversation with new message data
          const updatedConversation = {
            ...conversation,
            last_message: messageData,
            has_new_message: messageData.sender_id !== userId, // Show indicator if not from current user
            unread_count: messageData.sender_id !== userId 
              ? (conversation.unread_count || 0) + 1 
              : conversation.unread_count,
            // Preserve server/client `seen` flag instead of forcing false when I send a message.
            // The server is the source of truth and will broadcast read events.
            seen: conversation.seen,
            // Ensure last sender/receiver are stored for reliable home-screen logic
            sender_id: messageData.sender_id,
            receiver_id: messageData.receiver_id,
          };
          
          // Remove conversation from current position and add to top
          updatedConversations.splice(conversationIndex, 1);
          updatedConversations.unshift(updatedConversation);
          
          return updatedConversations;
        } else {
          if (__DEV__) {
            console.log('⚠️ [CONVERSATIONS] Conversation not found for optimistic update:', {
              otherUserId,
              messageData: {
                id: messageData.id,
                sender_id: messageData.sender_id,
                receiver_id: messageData.receiver_id
              },
              availableConversations: prevConversations.map(c => ({
                id: c.id,
                otherUserId: c.otherUser?.id,
                other_user_id: c.other_user_id,
                contact_id: c.contact_id,
                sender_id: c.sender_id,
                receiver_id: c.receiver_id
              }))
            });
          }
        }
        
        return prevConversations;
      });
    } 
    
    // Handle all read status events immediately with consolidated logic
    if ((eventType === 'messageReceived' && data?.type === 'message_read') || 
        eventType === 'messageRead' || 
        eventType === 'messageReadStatusUpdated' ||
        eventType === 'readStatusUpdate' ||
        (eventType === 'conversationUpdate' && (data?.type === 'message_read' || data?.type === 'message_seen' || data?.updateType === 'read_status'))) {
      
      hasOptimisticUpdate = true;
      
      if (__DEV__) {
        console.log('� [CONVERSATIONS] Processing read status update immediately:', {
          eventType,
          senderId: data.senderId,
          receiverId: data.receiverId,
          currentUserId: userId
        });
      }
      
      setConversations(prevConversations => {
        return prevConversations.filter(conv => {
          // Check if this read event affects this conversation using the correct structure
          const otherUserInvolved = (conv.otherUser?.id === data.senderId && userId === data.receiverId) ||
                                   (conv.otherUser?.id === data.receiverId && userId === data.senderId) ||
                                   (conv.other_user_id === data.senderId && userId === data.receiverId) ||
                                   (conv.other_user_id === data.receiverId && userId === data.senderId);
          
          const senderReceiverMatch = (conv.sender_id === data.senderId && conv.receiver_id === data.receiverId) ||
                                     (conv.sender_id === data.receiverId && conv.receiver_id === data.senderId);
          
          const conversationInvolvesUsers = otherUserInvolved || senderReceiverMatch;
          
          return true; // Keep all conversations - NSFW filtering handled by database
        }).map(conv => {
          // Apply normal read status updates to remaining conversations
          const otherUserInvolved = (conv.otherUser?.id === data.senderId && userId === data.receiverId) ||
                                   (conv.otherUser?.id === data.receiverId && userId === data.senderId) ||
                                   (conv.other_user_id === data.senderId && userId === data.receiverId) ||
                                   (conv.other_user_id === data.receiverId && userId === data.senderId);
          
          const senderReceiverMatch = (conv.sender_id === data.senderId && conv.receiver_id === data.receiverId) ||
                                     (conv.sender_id === data.receiverId && conv.receiver_id === data.senderId);
          
          const conversationInvolvesUsers = otherUserInvolved || senderReceiverMatch;
          
          if (conversationInvolvesUsers) {
            const isOutgoingForConv = conv.last_message?.sender_id === userId || conv.sender_id === userId
            const seenAtTs = data.seenAt || data.readAt || data.timestamp || new Date().toISOString()
            const targetMessageId = data.messageId || conv.last_message_id
            if (userId === data.receiverId) {
              // Current user is receiver - clear unread indicators
              if (__DEV__) console.log('✅ [CONVERSATIONS] Clearing unread indicators (user is receiver)');
              const updated = { 
                ...conv, 
                has_new_message: false,
                unread_count: 0,
                // If server marked seen, reflect that I (receiver) have seen it
                seen_by_me: true
              }
              // Also reflect last_seen fields when this concerns the current last_message
              if (!data.isNsfw && targetMessageId && (conv.last_message_id === targetMessageId || !data.messageId)) {
                updated.last_seen = true
                updated.last_seen_at = seenAtTs
                if (updated.last_message) {
                  updated.last_message = { ...updated.last_message, seen: true, seen_at: seenAtTs }
                }
              }
              return updated;
            } else if (userId === data.senderId && !data.isNsfw) {
              // Current user is sender - mark that the other side has seen my last message
              if (__DEV__) console.log('✅ [CONVERSATIONS] Marking as seen_by_other (user is sender)');
              const updated = { 
                ...conv, 
                seen: true,
                seen_by_other: true,
                // Ensure memoized ConversationItem re-renders by touching fields it compares
                last_seen: true,
                last_seen_at: seenAtTs
              }
              // Also mirror onto last_message for consistency (the comparator checks this)
              if (updated.last_message && (conv.last_message_id === targetMessageId || !data.messageId)) {
                updated.last_message = { ...updated.last_message, seen: true, seen_at: seenAtTs }
              }
              return updated;
            } else {
              return conv;
            }
          }
          return conv;
        });
      });
    }
    
    // Schedule server refresh with appropriate timing
    const refreshDelay = hasOptimisticUpdate ? 1500 : BATCH_DEBOUNCE_TIME;
    
    debounceTimeoutRef.current = setTimeout(() => {
      if (hasOptimisticUpdate) {
        // For optimistic updates, do a silent background refresh to ensure consistency
        const fetchFn = fetchConversationsRef.current;
        if (fetchFn) {
          fetchFn({ forceRefresh: true, background: true, silent: true });
        }
      } else {
        // For other updates, use the normal batch processing
        const processFn = processPendingUpdatesRef.current;
        if (processFn) {
          processFn();
        }
      }
      debounceTimeoutRef.current = null;
    }, refreshDelay);
  }, [userId]); // Only depend on userId, remove processPendingUpdates and fetchConversations

  // Setup background refresh logic for when app returns to foreground
  useEffect(() => {
    console.log('🟠 [TRACE] useEffect (background refresh setup)');
    const handleAppStateChange = (nextAppState) => {
      // When app comes to foreground from background
      if (
        appStateRef.current.match(/inactive|background/) && 
        nextAppState === 'active' &&
        initialLoadCompletedRef.current
      ) {
        if (__DEV__) console.log('🔄 [CONVERSATIONS] App returned to foreground, refreshing');
        const fetchFn = fetchConversationsRef.current;
        if (fetchFn) {
          fetchFn({ forceRefresh: true, silent: true });
        }
      }
      appStateRef.current = nextAppState;
    };
    
    // Set up app state listener
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => {
      subscription.remove();
    };
  }, []); // Remove fetchConversations dependency to prevent re-running

  // Initial load effect - FIXED: Only run when userId changes, not when fetchConversations changes
  useEffect(() => {
    console.log('🟠 [TRACE] useEffect (initial load)', { userId });
    isMountedRef.current = true;
    
    if (userId) {
      // Only fetch if we don't have conversations yet or userId actually changed
      if (conversations.length === 0 || !initialLoadCompletedRef.current) {
        const fetchFn = fetchConversationsRef.current;
        if (fetchFn) {
          fetchFn();
        }
      }
      
      // Set up periodic background refresh only once
      if (!backgroundRefreshRef.current) {
        backgroundRefreshRef.current = setInterval(() => {
          if (isMountedRef.current && initialLoadCompletedRef.current) {
            const fetchFn = fetchConversationsRef.current;
            if (fetchFn) {
              fetchFn({ background: true, silent: true });
            }
          }
        }, BACKGROUND_REFRESH_INTERVAL);
      }
    }
    
    return () => {
      // Only cleanup when component unmounts, not on every effect run
      if (!userId) {
        isMountedRef.current = false;
        if (backgroundRefreshRef.current) {
          clearInterval(backgroundRefreshRef.current);
          backgroundRefreshRef.current = null;
        }
        if (debounceTimeoutRef.current) {
          clearTimeout(debounceTimeoutRef.current);
          debounceTimeoutRef.current = null;
        }
      }
    };
  }, [userId]); // Only depend on userId, not fetchConversations

  // Register for realtime events - FIXED: Stable dependency
  useEffect(() => {
    console.log('🟠 [TRACE] useEffect (realtime events setup)', { userId });
    if (!userId) return;

    // Event types to monitor
    const eventTypes = [
      'messageReceived',
      'messageSent', 
      'conversationUpdate',
      'conversationListUpdated',
      'readStatusUpdate',
      'messageReadStatusUpdated',
      'messageRead'
    ];
    
    // Create stable event handlers with common implementation
    const handlers = {};
    eventTypes.forEach(eventType => {
      handlers[eventType] = (data) => {
        // Only process events if component is still mounted and userId matches
        if (isMountedRef.current && userId) {
          batchedUpdateHandler(eventType, data);
        }
      };
      realtimeCacheManager.on(eventType, handlers[eventType]);
    });

    return () => {
      eventTypes.forEach(eventType => {
        realtimeCacheManager.off(eventType, handlers[eventType]);
      });
    };
  }, [userId]); // Only depend on userId, not batchedUpdateHandler

  // Ensure Home re-renders immediately when realtime updates conversation list
  useEffect(() => {
    if (!userId) return;
    const onConvListUpdated = (data) => {
      try {
        if (data?.conversationUserId === userId || data?.userId === userId || data?.conversationId) {
          if (__DEV__) console.log('🔔 [CONVERSATIONS] conversationListUpdated event received, forcing re-render')
          setRefreshToken(Date.now())
        }
      } catch (e) {}
    }

    realtimeCacheManager.on('conversationListUpdated', onConvListUpdated)
    realtimeCacheManager.on('conversationUpdate', onConvListUpdated)

    return () => {
      realtimeCacheManager.off('conversationListUpdated', onConvListUpdated)
      realtimeCacheManager.off('conversationUpdate', onConvListUpdated)
    }
  }, [userId])

  // Enhanced API with additional capabilities
  return {
    conversations,
    loading,
    error,
    refresh: useCallback((options = {}) => {
      const fetchFn = fetchConversationsRef.current;
      if (fetchFn) {
        // Default to forceRefresh: true for backward compatibility, but allow override
        const { forceRefresh = true, ...otherOptions } = options;
        return fetchFn({ forceRefresh, ...otherOptions });
      }
    }, []), // No dependencies needed since we use ref
    refreshToken, // For optimized FlatList rendering
    getConversationSignature, // Expose for parent components
    stats: useMemo(() => ({
      fetchCount: metricsRef.current.fetchCount,
      eventCount: metricsRef.current.eventCount,
      lastRenderTime: metricsRef.current.lastRenderTime
    }), [metricsRef.current.fetchCount, metricsRef.current.eventCount, metricsRef.current.lastRenderTime])
  };
};

export { useSimpleConversations };
