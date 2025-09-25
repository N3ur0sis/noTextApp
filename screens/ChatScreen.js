/**
 * ChatScreen - Simplified and Optimized
 * Minimal complexity, consistent hooks, optimal performance
 */

import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { useChatScreenCaptureGuard } from '../hooks/useChatScreenCaptureGuard'
import { StatusBar as ExpoStatusBar } from 'expo-status-bar'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  AppState,
  Dimensions,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator
} from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Extrapolate,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming
} from 'react-native-reanimated'
import CachedImage from '../components/CachedImage'
import CachedVideo from '../components/CachedVideo'
import VideoPlayerWrapper from '../components/VideoPlayerWrapper'
import OneTimeBlurOverlay from '../components/OneTimeBlurOverlay'
import NSFWTimerOverlay from '../components/NSFWTimerOverlay'
import NSFWTapToViewOverlay from '../components/NSFWTapToViewOverlay'
import { BorderRadius, Colors, Spacing, Typography } from '../constants/Design'
import { useAuthContext } from '../context/AuthContext'
import { useSlidingWindowMessages } from '../hooks/useSlidingWindowMessages'
import { oneTimeViewService } from '../services/oneTimeViewService'
import { nsfwViewService } from '../services/nsfwViewService'
import { markMessageAsSeen } from '../services/userService'
import { apiManager } from '../services/apiManager'
import { chatStore } from '../data/stores/chatStore'
import { messagesCache } from '../data/messagesCache'
import { getMediaTypeInfo } from '../utils/mediaTypeUtils'
import { formatRelativeTime } from '../utils/timeUtils'
import { backgroundMessageService } from '../services/backgroundMessageService'
import ReportContentModal from '../components/ReportContentModal'
import { blockService } from '../services/blockService'
import { chatVisibilityService } from '../services/chatVisibilityService'
import { unreadCountService } from '../services/unreadCountService'
import ReportEmailService from '../services/reportEmailService'
import { useChatMediaPreloader } from '../utils/mediaPreloaders' // P5 FIX: Import media preloader

// Import debug utility in development
if (__DEV__) {
  import('../services/oneTimeViewDebugger')
}

// Get proper dimensions for Android edge-to-edge
const { width, height } = Platform.OS === 'android' 
  ? Dimensions.get('screen') // Full screen height on Android with edge-to-edge
  : Dimensions.get('window') // Window height on iOS

const ChatScreen = () => {
  console.log('🟣 [TRACE] ChatScreen render');
  // Prevent screen capture on iOS only for this screen
  //useChatScreenCaptureGuard();
  console.log('🟣 [TRACE] useChatScreenCaptureGuard');
  // 1. ALWAYS call core hooks first - NEVER conditionally
  const authContext = useAuthContext()
  console.log('🟣 [TRACE] useAuthContext', { authContext });
  const params = useLocalSearchParams()
  console.log('🟣 [TRACE] useLocalSearchParams', { params });

  // 2. ALWAYS call state hooks - NEVER conditionally
  // Initialize currentIndex to -1 to indicate not yet set, avoid showing first message briefly
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [viewedMessages, setViewedMessages] = useState(new Set())
  const [renderedMessages, setRenderedMessages] = useState(new Set()) // Track which messages have been rendered on screen
  const [showCameraHint, setShowCameraHint] = useState(true)
  const [oneTimeViewedMessages, setOneTimeViewedMessages] = useState(new Set())
  const [blurredMessages, setBlurredMessages] = useState(new Set())
  const [optimisticBlurredMessages, setOptimisticBlurredMessages] = useState(new Set())
  const [hasUserInteracted, setHasUserInteracted] = useState(false) // Track if user has actually swiped
  const [userViewedMessages, setUserViewedMessages] = useState(new Set()) // Track messages actually viewed by user interaction
  const [blockedUsers, setBlockedUsers] = useState([]) // Track blocked users for filtering
  console.log('🟣 [TRACE] useState', { currentIndex, viewedMessages, renderedMessages, showCameraHint, oneTimeViewedMessages, blurredMessages, optimisticBlurredMessages, hasUserInteracted, userViewedMessages });
  // NSFW timer state
  const [nsfwTimerState, setNsfwTimerState] = useState({
    messageId: null,
    isActive: false,
    progress: 0,
    timeRemaining: 0,
    videoCallbacks: null // For video-specific callbacks (duration, end detection)
  })
  
  // NSFW Tap-to-View State - tracks messages waiting for tap to start timer
  const [nsfwTapToViewState, setNsfwTapToViewState] = useState({
    messageId: null,
    isWaiting: false
  })

  // Store video durations for NSFW messages
  const [nsfwVideoDurations, setNsfwVideoDurations] = useState({})
  
  const [removingMessageId, setRemovingMessageId] = useState(null) // For removal state tracking
  const [suspendMedia, setSuspendMedia] = useState(false) // Temporarily unmount media when opening camera
  const [showReportModal, setShowReportModal] = useState(false)
  const [selectedMessageForReport, setSelectedMessageForReport] = useState(null)

  // 3. ALWAYS call animation hooks - NEVER conditionally
  // Initialize carousel position to prevent flash - will be updated when messages load
  const carouselTranslateX = useSharedValue(0)
  const hintOpacity = useSharedValue(1)
  const screenTranslateY = useSharedValue(0)
  const screenScale = useSharedValue(1)
  // Swipe-up camera overlay progress (0..1)
  const cameraOverlayProgress = useSharedValue(0)

  // Initialize carousel position immediately when messages are available - OPTIMIZED to prevent flash
  // ENHANCED: Better handling for conversations with any message count
  useEffect(() => {
    if (messages && messages.length > 0 && currentIndex === -1) { // Only on initial load
      const lastIndex = messages.length - 1
      console.log(`🎯 [INIT] Initializing carousel for ${messages.length} messages, setting currentIndex to ${lastIndex}`)
      // OPTIMIZATION: Set position immediately without animation to prevent flash
      carouselTranslateX.value = -lastIndex * width
      setCurrentIndex(lastIndex)
    }
    
    // CONSISTENCY FIX: Handle message count changes more gracefully for small conversations
    if (messages && messages.length > 0 && currentIndex >= 0) {
      const expectedPosition = -currentIndex * width
      const currentPosition = carouselTranslateX.value
      const positionDrift = Math.abs(expectedPosition - currentPosition)
      
      // If position has drifted significantly (can happen during optimistic updates), correct it
      if (positionDrift > width * 0.1) { // 10% threshold
        console.log(`🔧 [POSITION] Correcting carousel position drift: expected ${expectedPosition}, actual ${currentPosition}`)
        carouselTranslateX.value = withSpring(expectedPosition, {
          damping: 25,
          stiffness: 300,
          mass: 0.6
        })
      }
    }
  }, [messages, width, carouselTranslateX, currentIndex]) // Remove messages?.length dependency

  // Safety: clamp currentIndex when the list shrinks (e.g., after NSFW removal)
  // FIXED: Enhanced stability for conversations with < 10 messages
  useEffect(() => {
    const len = Array.isArray(messages) ? messages.length : 0
    if (len === 0) {
      // No messages to show; reset index
      if (currentIndex !== -1) setCurrentIndex(-1)
      return
    }
    
    // STABILITY FIX: Be more careful about when to clamp index
    if (currentIndex >= len) {
      const newIndex = Math.max(0, len - 1)
      console.log(`🔧 [SAFETY] Clamping currentIndex from ${currentIndex} to ${newIndex} (messages length: ${len})`)
      setCurrentIndex(newIndex)
      // Only update carousel if not currently removing a message (prevents flickering)
      if (!removingMessageId) {
        carouselTranslateX.value = withSpring(-newIndex * width, {
          damping: 20,
          stiffness: 200,
          mass: 0.8
        })
      }
    } else if (currentIndex === -1 && len > 0) {
      // SMALL CONVERSATION FIX: If we have no index but messages exist, go to last message
      // This ensures consistent behavior for conversations with any number of messages
      const lastIndex = len - 1
      setCurrentIndex(lastIndex)
      if (!removingMessageId) {
        carouselTranslateX.value = withSpring(-lastIndex * width, {
          damping: 20,
          stiffness: 200,
          mass: 0.8
        })
      }
    }
  }, [messages?.length, carouselTranslateX, width, currentIndex, removingMessageId])

  // Position preservation for optimistic message handling
  const previousMessagesRef = useRef([])
  const userPositionRef = useRef({ messageId: null, index: -1 })

  // Track user's current viewing position for preservation during updates
  useEffect(() => {
    if (messages && messages.length > 0 && currentIndex >= 0 && currentIndex < messages.length) {
      const currentMessage = messages[currentIndex]
      if (currentMessage && currentMessage.id) {
        userPositionRef.current = {
          messageId: currentMessage.id,
          index: currentIndex
        }
      }
    }
  }, [messages, currentIndex])

  // STABILITY FIX: Preserve user position during optimistic → real message transitions
  useEffect(() => {
    if (!messages || messages.length === 0) return
    
    const prevMessages = previousMessagesRef.current
    const prevLength = prevMessages.length
    const currentLength = messages.length
    
    // Detect if we're dealing with optimistic message replacement
    if (prevLength > 0 && currentLength > 0 && userPositionRef.current.messageId) {
      const prevHadOptimistic = prevMessages.some(m => m._isSending)
      const currentHasOptimistic = messages.some(m => m._isSending)
      
      // If optimistic messages were resolved, try to preserve user's position
      if (prevHadOptimistic && !currentHasOptimistic) {
        const targetMessageId = userPositionRef.current.messageId
        const newIndex = messages.findIndex(m => m.id === targetMessageId)
        
        if (newIndex >= 0 && newIndex !== currentIndex) {
          console.log(`🎯 [PRESERVE] Restoring user position to message ${targetMessageId} at index ${newIndex} (was ${currentIndex})`)
          setCurrentIndex(newIndex)
          carouselTranslateX.value = withSpring(-newIndex * width, {
            damping: 20,
            stiffness: 200,
            mass: 0.8
          })
        }
      }
    }
    
    // Update reference for next comparison
    previousMessagesRef.current = [...messages]
  }, [messages, currentIndex, carouselTranslateX, width])

  // 4. Parse data with stable references
  const currentUser = authContext?.user || null
  const otherUser = useMemo(() => {
    console.log('🟣 [TRACE] useMemo (otherUser)', { param: params.otherUser });
    try {
      // If we have a direct otherUser parameter (from conversation navigation)
      if (params.otherUser) {
        return JSON.parse(params.otherUser)
      }
      // If we have userId and pseudo (from notification navigation)
      if (params.userId && params.pseudo) {
        return {
          id: params.userId,
          pseudo: decodeURIComponent(params.pseudo)
        }
      }
      return null
    } catch (error) {
      console.error('❌ [CHAT] Error parsing otherUser:', error)
      return null
    }
  }, [params.otherUser, params.userId, params.pseudo])
  const otherUserId = params.otherUserId || params.userId || otherUser?.id

  // 5. ALWAYS call the messages hook - let it handle null values internally
  const {
    messages: rawMessages,
    loading, 
    error, 
    refresh, 
    syncWithDatabase,
    markAsRead,
    removeNsfwMessage,
    windowSize,
    isWindowFull,
    lastMessageId
  } = useSlidingWindowMessages(currentUser?.id, otherUserId, true, `${currentUser?.id}_${otherUserId}`)
  console.log('🟣 [TRACE] useSlidingWindowMessages', { currentUserId: currentUser?.id, otherUserId, messagesCount: rawMessages?.length });

  // Initialize block service and listen for changes
  useEffect(() => {
    const initializeBlockService = async () => {
      await blockService.initialize()
      const blocked = await blockService.getBlockedUsers()
      setBlockedUsers(blocked)
    }

    initializeBlockService()

    // Listen for block list changes
    const unsubscribe = blockService.addListener((updatedBlockedUsers) => {
      setBlockedUsers(updatedBlockedUsers)
    })

    return unsubscribe
  }, [])

  // EGRESS OPTIMIZATION: Removed redundant first useFocusEffect 
  // All focus refresh logic consolidated in the main focus effect below

  // Add safety deduplication for messages to prevent React key conflicts
  const messages = useMemo(() => {
    console.log('🟣 [TRACE] useMemo (messages)', { rawMessages });
    try {
      if (!rawMessages || rawMessages.length === 0) return rawMessages
      
      // Filter out messages from blocked users first
      const unblocked = rawMessages.filter(message => {
        if (!message || !message.sender_id) return true
        const isBlocked = blockedUsers.includes(String(message.sender_id))
        if (isBlocked) {
          console.log('📵 [CHAT] Filtering blocked message:', { senderId: message.sender_id })
        }
        return !isBlocked
      })
      
        // If a message is currently being removed, keep it in the array to prevent issues
        if (removingMessageId) {
          console.log(`🔄 [NSFW] Removal in progress for ${removingMessageId}, filtering normally`)
          const seenIds = new Set()
          return unblocked.filter(message => {
            if (!message || !message.id) {
              console.warn(`🚨 [CHAT] Invalid message detected and filtered:`, message)
              return false  
            }
            if (seenIds.has(message.id)) {
              console.warn(`🚨 [CHAT] Duplicate message detected and filtered: ${message.id}`)
              return false
            }
            seenIds.add(message.id)
            return true
          })
        }      // Normal deduplication when no removal is in progress
      const seenIds = new Set()
      const deduplicatedMessages = unblocked.filter(message => {
        if (!message || !message.id) {
          console.warn(`🚨 [CHAT] Invalid message detected and filtered:`, message)
          return false
        }
        if (seenIds.has(message.id)) {
          console.warn(`🚨 [CHAT] Duplicate message detected and filtered: ${message.id}`)
          return false
        }
        seenIds.add(message.id)
        return true
      })
      
      return deduplicatedMessages
    } catch (error) {
      console.error('❌ [CHAT] Error processing messages:', error)
      // Return empty array on error to prevent crashes
      return []
    }
  }, [rawMessages, removingMessageId, blockedUsers])

  // P5 FIX: Preload media for all messages to reduce sign/GET calls
  useChatMediaPreloader(messages)

  // Subscribe to read status updates for real-time read receipts
  // NOTE: Sliding window hook already handles messageReadStatusUpdated events
  // This ensures we don't have duplicate subscriptions causing conflicts
  useEffect(() => {
    if (!currentUser?.id || !otherUserId) return;

    console.log('📡 [CHAT] Setting up read status coordination with sliding window');

    const handleReadStatusUpdate = (data) => {
      if (!data || !data.messageId) return;

      // Only update if this message is relevant to this conversation
      const isRelevantMessage = (
        (data.senderId === currentUser.id && data.receiverId === otherUserId) ||
        (data.senderId === otherUserId && data.receiverId === currentUser.id)
      );

      if (!isRelevantMessage) return;

      console.log('📖 [CHAT] Read status update received:', data);

      // The sliding window hook already updates the messages state
      // We just need to ensure the UI reflects the changes
      // Force a re-render to ensure read indicators update
      // Note: setMessages is not available in sliding window hook
    };

    // Import realtimeCacheManager dynamically to avoid circular imports
    import('../services/realtimeCacheManager').then(({ realtimeCacheManager }) => {
      // Only subscribe to events that the sliding window doesn't handle
      realtimeCacheManager.on('messageReadStatusUpdated', handleReadStatusUpdate);
      
      // Listen for app returning from background (force refresh)
      const handleAppReturnFromBackground = (data) => {
        console.log('🔄 [CHAT] App returned from background, forcing message refresh:', data)
        if (refresh) {
          console.log('🔄 [CHAT] Force refreshing messages after background return')
          refresh({ forceRefresh: true, silent: false })
        }
      }
      realtimeCacheManager.on('appReturnedFromBackground', handleAppReturnFromBackground);

      return () => {
        realtimeCacheManager.off('messageReadStatusUpdated', handleReadStatusUpdate);
        realtimeCacheManager.off('appReturnedFromBackground', handleAppReturnFromBackground);
      };
    }).catch(err => {
      console.error('❌ [CHAT] Failed to subscribe to read status updates:', err);
    });
  }, [currentUser?.id, otherUserId]);

  // Handle new message arrival but do NOT mark as read automatically
  // Read receipts will only be sent when user actually views the message by swiping to it
  useEffect(() => {
    if (!currentUser?.id || !otherUserId || !messages.length) return;

    console.log('🔄 [CHAT] New messages loaded - waiting for user to view them before marking as read');

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) return;

    // Only log the arrival of new messages, don't mark as read yet
    const isIncomingMessage = lastMessage.sender_id !== currentUser.id;
    const isUnseen = lastMessage.seen !== true;

    if (isIncomingMessage && isUnseen) {
      console.log('📖 [CHAT] Found unseen incoming message - will mark as read when user views it:', lastMessage.id);
      // Removed automatic commitReadUpTo call - user must view message first
    }
  }, [messages, currentUser?.id, otherUserId]);

  // Handle notification navigation with enhanced media loading and auto-read marking
  const [isLoadingFromNotification, setIsLoadingFromNotification] = useState(false)
  
  useEffect(() => {
    const handleNotificationNavigation = async () => {
      // Check if we came from a notification
      if (params.fromNotification === 'true' && currentUser?.id && otherUserId) {
        console.log('📱 [CHAT] Opened from notification, ensuring proper loading...')
        setIsLoadingFromNotification(true)
        
        try {
          // Force refresh when opened from notification to ensure latest data
          console.log('📱 [CHAT] Force refreshing messages for notification navigation...')
          if (refresh) {
            await refresh({ forceRefresh: true })
          }
          
          // Clear notifications for this conversation
          console.log('📱 [CHAT] Clearing notifications for this conversation...')
          try {
            const { notificationIntegrationService } = await import('../services/notificationIntegration')
            await notificationIntegrationService.clearNotificationsForConversation(otherUserId)
            console.log('✅ [CHAT] Notifications cleared for conversation')
          } catch (error) {
            console.error('❌ [CHAT] Error clearing notifications:', error)
          }
          
          // Give a moment for refresh to complete
          await new Promise(resolve => setTimeout(resolve, 500))
          
          // Auto-mark unread messages as read when opened from notification
          if (messages && messages.length > 0) {
            console.log('📱 [CHAT] Navigation from notification - checking messages for auto-read')
            
            // Extract media type information from notification parameters
            const notificationMessageId = params.messageId
            const notificationIsNsfw = params.isNsfw === 'true'
            const notificationIsOneTime = params.isOneTime === 'true'
            const notificationMediaType = params.mediaType ? decodeURIComponent(params.mediaType) : null
            
            if (notificationMessageId) {
              console.log(`📱 [CHAT] Notification for specific message: ${notificationMessageId}`, {
                isNsfw: notificationIsNsfw,
                isOneTime: notificationIsOneTime,
                mediaType: notificationMediaType
              })
            }
            
            // Find unread messages from the other user, excluding NSFW and one-time messages
            const unreadMessages = messages.filter(msg => 
              msg.sender_id === otherUserId && 
              msg.seen !== true &&
              !userViewedMessages.has(msg.id) &&
              // PROTECTION: Don't auto-mark NSFW or one-time messages as read
              msg.is_nsfw !== true &&
              msg.view_once !== true &&
              // Additional protection: if this is the specific notification message and it's NSFW/one-time, don't auto-read
              !(msg.id === notificationMessageId && (notificationIsNsfw || notificationIsOneTime))
            )
            
            // Also get the NSFW/one-time messages for logging
            const protectedMessages = messages.filter(msg => 
              msg.sender_id === otherUserId && 
              msg.seen !== true &&
              !userViewedMessages.has(msg.id) &&
              (msg.is_nsfw === true || 
               msg.view_once === true ||
               // Include notification-specific protected messages
               (msg.id === notificationMessageId && (notificationIsNsfw || notificationIsOneTime)))
            )
            
            if (protectedMessages.length > 0) {
              console.log(`🔒 [CHAT] Found ${protectedMessages.length} NSFW/one-time messages - NOT auto-marking as read:`, 
                protectedMessages.map(m => ({ 
                  id: m.id, 
                  isNsfw: m.is_nsfw || (m.id === notificationMessageId && notificationIsNsfw), 
                  isOneTime: m.view_once || (m.id === notificationMessageId && notificationIsOneTime),
                  fromNotification: m.id === notificationMessageId
                })))
            }
            
            if (unreadMessages.length > 0) {
              console.log(`📱 [CHAT] Found ${unreadMessages.length} safe unread messages to mark as read from notification`)
              
              // Mark all safe unread messages as user viewed
              setUserViewedMessages(prev => {
                const updated = new Set(prev)
                unreadMessages.forEach(msg => updated.add(msg.id))
                AsyncStorage.setItem('userViewedMessages', JSON.stringify([...updated])).catch(console.error)
                return updated
              })
              
              // Mark as viewed in legacy system too
              setViewedMessages(prev => {
                const updated = new Set(prev)
                unreadMessages.forEach(msg => updated.add(msg.id))
                AsyncStorage.setItem('viewedMessages', JSON.stringify([...updated])).catch(console.error)
                return updated
              })
              
              // Mark each message as read on the server
              for (const msg of unreadMessages) {
                try {
                  console.log(`📱 [CHAT] Auto-marking message as read from notification: ${msg.id}`)
                  await apiManager.markMessageAsRead(msg.id, currentUser.id)
                  await unreadCountService.markMessageAsRead(msg.id)
                } catch (error) {
                  console.error(`❌ [CHAT] Error auto-marking message ${msg.id} as read:`, error)
                }
              }
              
              console.log(`✅ [CHAT] Auto-marked ${unreadMessages.length} messages as read from notification`)
            }
          }
          
          console.log('✅ [CHAT] Notification navigation loading completed')
          
        } catch (error) {
          console.error('❌ [CHAT] Error during notification navigation loading:', error)
        } finally {
          // Add a final delay to ensure everything is settled
          setTimeout(() => {
            setIsLoadingFromNotification(false)
          }, 300)
        }
      }
    }
    
    handleNotificationNavigation()
  }, [params.fromNotification, currentUser?.id, otherUserId, messages, refresh, userViewedMessages])

  // 6. Stable handlers first - prevent circular dependencies
  
  // REFINED: User-viewed read receipts with debouncing - only mark as read when user views messages
  const debounceTimeoutRef = useRef(null)
  const lastReadMessageIdRef = useRef(null) // Prevent duplicate reads

  // Refs for updateBlurStates to avoid circular dependencies
  const messagesRef = useRef(messages)
  const currentIndexRef = useRef(currentIndex)
  const currentUserRef = useRef(currentUser)

  // Update refs when values change
  messagesRef.current = messages
  currentIndexRef.current = currentIndex
  currentUserRef.current = currentUser

  const markSpecificMessageAsRead = useCallback(
    (message) => {
      if (!message || !currentUser?.id || !otherUserId) return
      if (message.sender_id !== otherUserId) return // Only mark messages from the other user
      if (message.seen === true) return // Skip if already seen upstream
      
      // Check if we already processed this specific message
      if (lastReadMessageIdRef.current === message.id) {
        console.log(`📝 [USER_READ] Skipping duplicate read for message: ${message.id}`)
        return
      }
      
      // Clear any existing timeout for this message
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current)
      debounceTimeoutRef.current = setTimeout(async () => {
        try {
          console.log(`📝 [USER_READ] User viewed message, marking ONLY this message as read: ${message.id}`)
          lastReadMessageIdRef.current = message.id // Mark as processed

          // Mark ONLY this specific message as seen locally
          try {
            // Use the markAsRead function from the hook instead of setMessages
            if (markAsRead) {
              await markAsRead(message.id)
            }
            
            // Mark only this message in the messages cache using existing method
            await messagesCache.setSeenForPair(currentUser.id, otherUserId, [message.id])
          } catch (e) { console.warn('⚠️ [USER_READ] optimistic local mark failed', e) }

          // Call server to mark ONLY this specific message as read
          await apiManager.markMessageAsRead(message.id, currentUser.id)

          // Update unread count service
          await unreadCountService.markMessageAsRead(message.id)

          // Trigger conversation state update to reflect read status change
          try {
            // Import realtimeCacheManager to update conversation state
            const { realtimeCacheManager } = await import('../services/realtimeCacheManager')
            await realtimeCacheManager.updateMessageInConversationCache({
              id: message.id,
              sender_id: message.sender_id,
              receiver_id: message.receiver_id,
              seen: true,
              seen_at: new Date().toISOString()
            })
            console.log(`🔄 [USER_READ] Updated conversation cache for read message: ${message.id}`)
          } catch (convError) {
            console.warn('⚠️ [USER_READ] Failed to update conversation cache:', convError)
          }

          console.log(`✅ [USER_READ] Successfully marked single message as read: ${message.id}`)
        } catch (error) {
          console.error('❌ [USER_READ] Error marking message as read:', error)
          lastReadMessageIdRef.current = null // Reset on error
        }
      }, 500) // Reduced timeout for faster read receipts (was 1000ms)
    },
    [currentUser?.id, otherUserId]
  )

  const handleMediaRendered = useCallback((messageId) => {
    console.log('🖼️ [MEDIA_RENDER] Media rendered for message:', messageId);
    
    // Find the message to check if it's from current user
    const message = messages.find(msg => msg.id === messageId);
    if (!message) {
      console.warn('⚠️ [MEDIA_RENDER] Message not found:', messageId);
      return;
    }
    
    // Only mark messages from other users as rendered (for read receipts)
    if (message.sender_id === currentUser?.id) {
      console.log('🚫 [MEDIA_RENDER] Skipping render tracking for own message:', messageId);
      return;
    }
    
    setRenderedMessages(prev => {
      const updated = new Set(prev);
      updated.add(messageId);
      return updated;
    });
  }, [messages, currentUser?.id]); // Add dependencies for message lookup

  const markCurrentMessageAsSeen = useCallback(async (message) => {
    console.log('🟣 [TRACE] markCurrentMessageAsSeen', { message });
    // P1 FIX: Remove redundant per-message marking. Will be handled by batch read receipts.
    // Individual message marking is now handled at conversation level for better performance.
    return
  }, [currentUser])

  const handleMessageView = useCallback(async (message) => {
    console.log('🟣 [TRACE] handleMessageView', { message });
    if (!message) return
    setViewedMessages(prev => {
      const updated = new Set(prev)
      updated.add(message.id)
      AsyncStorage.setItem('viewedMessages', JSON.stringify([...updated])).catch(console.error)
      return updated
    })
    await markCurrentMessageAsSeen(message)
  }, [markCurrentMessageAsSeen])

  // Function to update blur states: only blur if view_once and has been marked as viewed (seen) by swiping away
  const updateBlurStates = useCallback(() => {
    console.log('🟣 [TRACE] updateBlurStates called');
    const messages = messagesRef.current
    const currentUser = currentUserRef.current
    const currentIndex = currentIndexRef.current

    if (!messages || messages.length === 0 || !currentUser?.id) return

    const newBlurredMessages = new Set()
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i]
      // Only blur for one-time messages received by current user
      if (message.view_once && message.receiver_id === currentUser.id) {
        // Use shouldShowBlur which properly handles current viewing state
        // This will return true only if the message has been viewed AND is not currently being viewed
        const shouldBlur = oneTimeViewService.shouldShowBlur(message.id, currentUser.id, message)
        
        if (shouldBlur) {
          newBlurredMessages.add(message.id)
        }
        
        // Enhanced debugging for blur logic
        console.log(`🔍 [BLUR] Message ${message.id}:`, {
          shouldBlur,
          messageIndex: i,
          currentIndex,
          isViewed: oneTimeViewService.isViewed(message.id),
          isCurrentlyViewing: oneTimeViewService.isCurrentlyViewing(message.id),
          view_once: message.view_once,
          receiver_id: message.receiver_id,
          currentUserId: currentUser.id,
          isReceiver: message.receiver_id === currentUser.id
        })
      }
    }
    
    console.log(`🔍 [BLUR] Updating blur states - ${newBlurredMessages.size} messages will be blurred:`, Array.from(newBlurredMessages))
    setBlurredMessages(newBlurredMessages)
  }, []) // Empty dependency array - function is now stable

  // Handle NSFW message removal with simple navigation
  const nsfwRemovalInProgressRef = useRef(new Set())
  const handleNsfwMessageRemoval = useCallback(async (messageId, messageIndex, skipNavigation = false, force = false) => {
    console.log('🟣 [TRACE] handleNsfwMessageRemoval', { messageId, messageIndex, skipNavigation });
    console.log(`🗑️ [NSFW] Handling removal of message ${messageId}, skipNavigation: ${skipNavigation}`)
    
    // Prevent multiple removals at once (race-safe)
    if (removingMessageId !== null || nsfwRemovalInProgressRef.current.has(messageId)) {
      console.log(`🛑 [NSFW] Already removing a message, skipping ${messageId}`)
      return
    }
    nsfwRemovalInProgressRef.current.add(messageId)
    
    // Validate messages array only; determine target by id if index is missing
    if (!messages || messages.length === 0) {
      console.log(`🛑 [NSFW] No messages available, skipping removal`)
      nsfwRemovalInProgressRef.current.delete(messageId)
      return
    }
    
    // Guard: only allow NSFW removal if message has been viewed or is in a viewing session
    let target = null;
    try {
      target = (typeof messageIndex === 'number' && messageIndex >= 0) ? messages?.[messageIndex] : null
      if (!target && messages && messageId) {
        target = messages.find(m => m.id === messageId)
      }
      
      console.log(`🔍 [NSFW] Target message lookup:`, {
        messageId,
        messageIndex,
        targetFound: !!target,
        targetId: target?.id,
        targetIsNsfw: target?.is_nsfw,
        targetReceiverId: target?.receiver_id,
        currentUserId: currentUser?.id
      });
      
      if (target && target.is_nsfw && target.receiver_id === currentUser?.id) {
        const isViewing = nsfwViewService.isCurrentlyViewing(messageId)
        const isViewed = nsfwViewService.isViewed(messageId)
        console.log(`🛡️ [NSFW] Guard check for ${messageId}: isViewing=${isViewing}, isViewed=${isViewed}, force=${force}`)
        if (!isViewing && !isViewed && !force) {
          console.log(`🛑 [NSFW] Removal blocked: message ${messageId} not viewed or in session`)
          nsfwRemovalInProgressRef.current.delete(messageId)
          return
        }
      } else if (target) {
        console.log(`ℹ️ [NSFW] Guard skipped: message not NSFW or not for current user`)
      } else {
        console.log(`⚠️ [NSFW] Guard skipped: target message not found`)
      }
    } catch (error) {
      console.error('❌ [NSFW] Error in guard check:', error)
      nsfwRemovalInProgressRef.current.delete(messageId)
      return
    }

    // Decide behavior based on view_once: only remove from UI if view-once
    const isNsfw = !!target?.is_nsfw
    const effectiveIndex = (typeof messageIndex === 'number' && messageIndex >= 0) 
      ? messageIndex 
      : messages.findIndex(m => m?.id === messageId)

    console.log(`🎯 [NSFW] Removal decision: isNsfw=${isNsfw}, force=${force}, target=${!!target}`)

    if (isNsfw || force) {
      console.log(`🎬 [NSFW] Starting removal for message ${messageId} (isNsfw: ${isNsfw}, force: ${force})`)

      try {
        // Set removing state to prevent other operations
        console.log(`🔄 [NSFW] Setting removingMessageId to ${messageId}`)
        setRemovingMessageId(messageId)

        // Reset timer state immediately
        setNsfwTimerState({
          messageId: null,
          isActive: false,
          progress: 0,
          timeRemaining: 0,
          videoCallbacks: null
        })

        // Calculate new index - move to previous message if this was the last one
        // Skip navigation when triggered by gesture (user already swiped away)
        if (!skipNavigation) {
          let newIndex = currentIndex
          if (messages.length > 1) {
            if (effectiveIndex === messages.length - 1) {
              // Was last message, move to previous
              newIndex = Math.max(0, effectiveIndex - 1)
            } else if (effectiveIndex < currentIndex) {
              // Removed message was before current, adjust current index
              newIndex = Math.max(0, currentIndex - 1)
            }
            // If removed message was after current, no index change needed
          }
          
          // Update carousel position immediately with smooth animation
          if (newIndex !== currentIndex) {
            console.log(`🎯 [NSFW] Smooth navigation from index ${currentIndex} to ${newIndex}`)
            // Update immediately without delay to prevent flickering
            carouselTranslateX.value = withSpring(-newIndex * width, {
              damping: 20,
              stiffness: 200,
              mass: 0.8
            })
            setCurrentIndex(newIndex)
          }
        } else {
          console.log(`🎯 [NSFW] Skipping navigation - user already swiped away`)
        }

        // Immediately remove from UI for instant feedback
        console.log(`🗑️ [NSFW] Calling removeNsfwMessage for ${messageId}`)
        removeNsfwMessage(messageId)
        console.log(`✅ [NSFW] removeNsfwMessage called for ${messageId}`)
        
        // Mark message as viewed and cancel any fallback timers if session exists
        console.log(`💾 [NSFW] Finalizing NSFW viewing for removal: ${messageId}`)
        const stopped = await nsfwViewService.stopViewing(messageId, true, currentUser?.id)
        if (!stopped) {
          // No active session; ensure DB + caches are updated
          await nsfwViewService.completeViewing(messageId, currentUser?.id)
        }
        console.log(`✅ [NSFW] Message finalized as viewed, removal complete: ${messageId}`)
        
        // Avoid forcing a refresh here to prevent flicker; caches + realtime will sync
      } catch (error) {
        console.error('❌ [NSFW] Error during NSFW message removal:', error)
        // Don't rethrow - we want cleanup to happen
      } finally {
        // Reset removal state - ALWAYS happens
        console.log(`🔄 [NSFW] Resetting removal state for ${messageId}, current removingMessageId: ${removingMessageId}`)
        setRemovingMessageId(null)
        nsfwRemovalInProgressRef.current.delete(messageId)
        console.log(`✅ [NSFW] Removal state reset complete for ${messageId}`)
      }
    } else {
      // Not NSFW and not forced: nothing to remove here (one-time handled by oneTimeViewService elsewhere)
      console.log(`ℹ️ [NSFW] Message ${messageId} is not NSFW and force=${force}, skipping removal`)
      setNsfwTimerState({
        messageId: null,
        isActive: false,
        progress: 0,
        timeRemaining: 0,
        videoCallbacks: null
      })
      nsfwRemovalInProgressRef.current.delete(messageId)
    }
  }, [messages, refresh, removeNsfwMessage, width, carouselTranslateX, currentUser, currentIndex])

  // NSFW timer handler - start timer when NSFW message becomes current
  const handleNsfwTimer = useCallback(async (message, messageIndex) => {
    console.log('🟣 [TRACE] handleNsfwTimer', { message, messageIndex });
    if (!message?.is_nsfw || !currentUser || message.sender_id === currentUser.id) {
      console.log(`❌ [NSFW] Skipping timer - invalid conditions:`, {
        hasMessage: !!message,
        isNsfw: message?.is_nsfw,
        hasCurrentUser: !!currentUser,
        isSender: message?.sender_id === currentUser?.id
      })
      return // Skip if not NSFW, no user, or user is sender
    }

    // Check if already viewed - if so, don't start timer
    const alreadyViewed = nsfwViewService.isViewed(message.id)
    console.log(`🔍 [NSFW] View status check for ${message.id}:`, {
      alreadyViewed,
      isCurrentlyViewing: nsfwViewService.isCurrentlyViewing(message.id),
      nsfwTimerActive: nsfwTimerState.isActive,
      nsfwTimerMessageId: nsfwTimerState.messageId
    })
    
    if (alreadyViewed) {
      console.log(`🔥 [NSFW] Message ${message.id} already viewed, skipping timer`)
      return
    }

    // If a viewing session already exists (e.g., due to prior tap), wire up UI state instead of returning
    if (nsfwViewService.isCurrentlyViewing(message.id)) {
      console.log(`🔥 [NSFW] Already viewing message ${message.id} — syncing UI state`)
      // Ensure timer overlay shows and video plays
      setNsfwTimerState(prev => ({
        ...prev,
        messageId: message.id,
        isActive: true,
        progress: 0,
        // Use stored duration if available; otherwise show a conservative fallback so UI is visible
        timeRemaining: nsfwVideoDurations[message.id] || 10,
        // No service callbacks can be injected at this stage; rely on Video onVideoEnd and duration load
        videoCallbacks: prev.videoCallbacks || null
      }))
      return
    }

    // Check if timer is already active for this message
    if (nsfwTimerState.isActive && nsfwTimerState.messageId === message.id) {
      console.log(`🔥 [NSFW] Timer already active for message ${message.id}`)
      return
    }

    console.log(`🔥 [NSFW] Starting timer for message ${message.id}`)

    try {
      if (message.media_type === 'video') {
        // For videos: Use the new video viewing approach that completes when video ends
        const started = await nsfwViewService.startVideoViewing(
          message.id,
          currentUser.id,
          // Completion callback - called when video ends
          () => {
            console.log(`🎬 [SERVICE] Video viewing completed for message ${message.id} - triggering removal from service`)
            
            // Update progress to 100% immediately to show completion
            setNsfwTimerState(prev => ({
              ...prev,
              messageId: message.id,
              isActive: true, // Keep active to show the completed state briefly
              progress: 1,
              timeRemaining: 0
            }))
            
            // Start removal process immediately (no delay needed for videos like images)
            console.log(`🎬 [SERVICE] Starting removal process for video message ${message.id}`)
            try {
              handleNsfwMessageRemoval(message.id, messageIndex)
            } catch (error) {
              console.error('❌ [SERVICE] Error calling handleNsfwMessageRemoval:', error)
              // Fallback: reset state and force navigation
              setNsfwTimerState({
                messageId: null,
                isActive: false,
                progress: 0,
                timeRemaining: 0,
                videoCallbacks: null
              })
              
              // Force navigation to previous message as fallback
              if (messages.length > 1) {
                const newIndex = Math.max(0, currentIndex - 1)
                setCurrentIndex(newIndex)
                carouselTranslateX.value = withSpring(-newIndex * width, {
                  damping: 20,
                  stiffness: 200,
                  mass: 0.8
                })
              }
            }
          },
          // Video player ready callback
          (nsfwServiceCallbacks) => {
            console.log(`🎥 [NSFW] Video player ready for message ${message.id}`)
            
            // Store video callbacks for when video player is actually created
            setNsfwTimerState(prev => ({
              ...prev,
              messageId: message.id,
              isActive: true,
              progress: 0,
              timeRemaining: 0, // Will be updated when video loads
              videoCallbacks: {
                onDurationLoad: (duration) => {
                  console.log(`🎬 [NSFW] Video duration loaded: ${duration}s for message ${message.id}`)
                  setNsfwTimerState(prev => ({
                    ...prev,
                    timeRemaining: duration
                  }))
                  // Pass duration to NSFW service for fallback timer
                  if (nsfwServiceCallbacks.onDurationLoad) {
                    nsfwServiceCallbacks.onDurationLoad(duration)
                  }
                },
                onVideoEnd: () => {
                  console.log(`🎬 [NSFW] Video ended for message ${message.id}`)
                  if (nsfwServiceCallbacks.onVideoEnded) {
                    nsfwServiceCallbacks.onVideoEnded()
                  }
                }
              }
            }))

            // If we already have the video duration stored, pass it immediately
            const storedDuration = nsfwVideoDurations[message.id]
            if (storedDuration) {
              console.log(`🎬 [NSFW] Using stored duration: ${storedDuration}s for message ${message.id}`)
              setNsfwTimerState(prev => ({
                ...prev,
                timeRemaining: storedDuration
              }))
              if (nsfwServiceCallbacks.onDurationLoad) {
                nsfwServiceCallbacks.onDurationLoad(storedDuration)
              }
            } else {
              // Start a conservative fallback right away to guarantee timer UI
              // This will be adjusted when real duration arrives
              const defaultSeconds = 10
              console.log(`⏱️ [NSFW] No stored duration; starting fallback for ${defaultSeconds}s`)
              setNsfwTimerState(prev => ({
                ...prev,
                timeRemaining: defaultSeconds
              }))
              if (nsfwServiceCallbacks.onDurationLoad) {
                nsfwServiceCallbacks.onDurationLoad(defaultSeconds)
              }
            }
          }
        )
        
        // Ensure playback flag is enabled even if callbacks race
        if (started) {
          setNsfwTimerState(prev => ({
            ...prev,
            messageId: message.id,
            isActive: true
          }))
        } else {
          console.log(`⚠️ [NSFW] Failed to start video viewing for message ${message.id}`)
        }
      } else {
        // For photos: Use the existing timer-based approach
        const started = await nsfwViewService.startViewing(
          message.id,
          message.media_type,
          0, // No video duration for photos
          currentUser.id,
          // Progress callback
          (progress) => {
            const timeRemaining = Math.max((5 * (1 - progress)), 0) // 5 seconds for photos

            setNsfwTimerState(prev => ({
              ...prev,
              messageId: message.id,
              isActive: true,
              progress,
              timeRemaining
            }))
          },
          // Completion callback - called when timer finishes
          () => {
            console.log(`⏰ [NSFW] Photo timer completed for message ${message.id}`)
            
            // Update progress to 100% immediately to show completion
            setNsfwTimerState(prev => ({
              ...prev,
              messageId: message.id,
              isActive: true, // Keep active to show the completed timer
              progress: 1,
              timeRemaining: 0
            }))
            
            // Start removal process
            console.log(`🖼️ [NSFW] Starting removal process for photo message ${message.id}`)
            try {
              handleNsfwMessageRemoval(message.id, messageIndex)
            } catch (error) {
              console.error('❌ [NSFW] Error calling handleNsfwMessageRemoval:', error)
              // Fallback: reset state
              setNsfwTimerState({
                messageId: null,
                isActive: false,
                progress: 0,
                timeRemaining: 0
              })
            }
          },
          // Removal callback - not used, completion callback handles removal
          null
        )

        if (started) {
          setNsfwTimerState(prev => ({
            ...prev,
            messageId: message.id,
            isActive: true,
            progress: 0,
            timeRemaining: 5 // 5 seconds for photos
          }))
        }
      }
    } catch (error) {
      console.error('❌ [NSFW] Error starting timer:', error)
    }
  }, [currentUser, nsfwTimerState.isActive, nsfwTimerState.messageId, handleNsfwMessageRemoval, nsfwVideoDurations])

  // Handle tap-to-view for NSFW messages
  const handleNsfwTapToView = useCallback(async (messageId) => {
    console.log(`👆 [NSFW] Tap-to-view triggered for message: ${messageId}`)
    
    // Find the message and debug its state
    const message = messages.find(m => m.id === messageId)
    const messageIndex = messages.findIndex(m => m.id === messageId)
    
    console.log(`🔍 [NSFW] Message state check:`, {
      messageId,
      messageFound: !!message,
      messageIndex,
      isNsfw: message?.is_nsfw,
      senderId: message?.sender_id,
      receiverId: message?.receiver_id,
      currentUserId: currentUser?.id,
      isViewed: nsfwViewService.isViewed(messageId),
      isCurrentlyViewing: nsfwViewService.isCurrentlyViewing(messageId),
      nsfwTimerActive: nsfwTimerState.isActive,
      nsfwTimerMessageId: nsfwTimerState.messageId
    })
    
    // Clear tap-to-view state
    setNsfwTapToViewState({
      messageId: null,
      isWaiting: false
    })
    
    if (message && messageIndex !== -1) {
      console.log(`🔥 [NSFW] Starting timer after tap for message: ${messageId}`)
      handleNsfwTimer(message, messageIndex)
    } else {
      console.log(`❌ [NSFW] Message not found for tap-to-view: ${messageId}`)
    }
  }, [messages, handleNsfwTimer, currentUser?.id, nsfwViewService, nsfwTimerState])

  // Stop NSFW timer when navigating away
  const stopNsfwTimer = useCallback(async (messageId) => {
    console.log('🟣 [TRACE] stopNsfwTimer', { messageId });
    if (!messageId) return
    
    // Don't try to stop if removal is already in progress
    if (removingMessageId === messageId) {
      console.log(`🛑 [NSFW] Message ${messageId} is being removed, skipping timer stop`)
      return
    }
    
    if (nsfwViewService.isCurrentlyViewing(messageId)) {
      console.log(`🛑 [NSFW] Pausing timer for message ${messageId} (navigation away, no removal) `)
      try {
        await nsfwViewService.stopViewing(messageId, false, currentUser?.id)
      } catch (_) {}
      // Reset timer state in UI
      setNsfwTimerState(prev => 
        prev.messageId === messageId 
          ? { messageId: null, isActive: false, progress: 0, timeRemaining: 0, videoCallbacks: null }
          : prev
      )
    }
  }, [currentUser, removingMessageId])

  // EGRESS OPTIMIZATION: Removed redundant mount useEffect 
  // All refresh logic is now handled by consolidated useFocusEffect to prevent duplicate API calls

  // Stabilize references used inside focus effect to avoid dependency re-runs
  const updateBlurStatesRef = useRef(updateBlurStates)
  // No need to update ref since updateBlurStates is now stable

  // Call updateBlurStates when dependencies change
  useEffect(() => {
    // Don't update blur states on initial screen load - wait for user interaction
    console.log('📖 [CHAT] updateBlurStates useEffect triggered, hasUserInteracted:', hasUserInteracted)
    if (!hasUserInteracted) {
      console.log('📖 [CHAT] Initial screen load - not updating blur states until user interacts')
      return
    }
    updateBlurStates()
  }, [messages, currentUser, currentIndex, hasUserInteracted])

  // Add focus effect to refresh when returning to chat screen - optimized to reduce redundant calls
  // CONSOLIDATED: All focus-related operations in one place to prevent duplicate API calls
  useFocusEffect(
    useCallback(() => {
      // Track chat visibility for notification prevention
      console.log(`👁️ [CHAT] Chat screen focused for user: ${otherUserId}`)
      chatVisibilityService.setChatVisible(otherUserId)

      // Set current chat user for notifications (legacy notification integration)
      console.log(`📱 [CHAT] Setting current chat user for notifications: ${otherUserId}`)
      import('../services/notificationIntegration').then(({ notificationIntegration }) => {
        notificationIntegration.setCurrentChatUser(otherUserId)
      }).catch(error => {
        console.error('❌ [CHAT] Failed to set current chat user for notifications:', error)
      })

      // Enhanced refresh logic to handle unread messages and background app state
      if (currentUser?.id && otherUserId && refresh) {
        const timeSinceLastFetch = Date.now() - (messagesLastFetch.current || 0)
        let shouldRefresh = false
        let forceRefresh = false

        // Check if we have unread messages that require fresh data
        const checkUnreadMessages = async () => {
          try {
            const unreadCount = await unreadCountService.getUnreadCountForConversation(currentUser.id, otherUserId)
            console.log(`📖 [CHAT] Focus: Found ${unreadCount} unread messages`)
            
            // If we have unread messages, force a refresh to ensure we get the latest
            if (unreadCount > 0) {
              console.log(`🔄 [CHAT] Found unread messages, forcing refresh to load latest data`)
              return { shouldRefresh: true, forceRefresh: true }
            }
            
            // Also check if we have very few or no messages loaded (background state recovery)
            if (!messages || messages.length === 0) {
              console.log(`🔄 [CHAT] No messages loaded, forcing refresh`)
              return { shouldRefresh: true, forceRefresh: true }
            }

            // Standard time-based refresh logic
            if (timeSinceLastFetch >= 10000) {
              console.log(`🔄 [CHAT] Standard refresh: last fetch was ${Math.round(timeSinceLastFetch/1000)}s ago`)
              return { shouldRefresh: true, forceRefresh: false }
            }

            return { shouldRefresh: false, forceRefresh: false }
          } catch (error) {
            console.error('❌ [CHAT] Error checking unread messages:', error)
            // Fallback to time-based refresh
            return { 
              shouldRefresh: timeSinceLastFetch >= 10000, 
              forceRefresh: false 
            }
          }
        }

        // Execute the check and refresh if needed
        checkUnreadMessages().then(({ shouldRefresh, forceRefresh }) => {
          if (shouldRefresh) {
            console.log(`🔄 [CHAT] Chat screen focused, refreshing messages: ${currentUser.id} <-> ${otherUserId} (force: ${forceRefresh})`)
            messagesLastFetch.current = Date.now()
            refresh({ forceRefresh, silent: false }) // Don't silence when we have unread messages
          } else {
            console.log(`✅ [CHAT] Very recent fetch (${Math.round(timeSinceLastFetch/1000)}s ago), skipping refresh`)
          }
        })
      }

      // Ensure blur overlays are correct shortly after focus
      setTimeout(() => { updateBlurStatesRef.current?.() }, 100)

      return () => {
        console.log(`�️ [CHAT] Chat screen unfocused for user: ${otherUserId}`)
        // Clear chat visibility tracking
        chatVisibilityService.setChatHidden()

        console.log(`�📱 [CHAT] Chat screen blur cleanup`)
        // Clear current chat user for notifications on real blur only
        import('../services/notificationIntegration').then(({ notificationIntegration }) => {
          notificationIntegration.setCurrentChatUser(null)
        }).catch(error => {
          console.error('❌ [CHAT] Failed to clear current chat user for notifications:', error)
        })
        
        // Clear one-time viewing sessions on blur
        const clearedCount = oneTimeViewService.clearAllCurrentlyViewing()
        if (clearedCount > 0) {
          console.log(`🔄 [ONE_TIME_VIEW] Cleared ${clearedCount} viewing sessions on screen blur`)
          updateBlurStatesRef.current?.()
        }
      }
    }, [currentUser?.id, otherUserId, refresh, messages])
  )

  // Removed duplicate useFocusEffect for one-time view session; merged into the consolidated focus effect above

  // Enhanced app state handling for background/foreground transitions
  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      console.log(`📱 [CHAT] App state changed to: ${nextAppState}`)
      
      if (nextAppState === 'active' && currentUser?.id && otherUserId && refresh) {
        // App came back to foreground - check if we need to refresh messages
        console.log(`🔄 [CHAT] App returned to foreground, checking for updates`)
        
        const checkAndRefresh = async () => {
          try {
            // Check if we have unread messages that might have arrived while in background
            const unreadCount = await unreadCountService.getUnreadCountForConversation(currentUser.id, otherUserId)
            
            if (unreadCount > 0) {
              console.log(`📖 [CHAT] Found ${unreadCount} unread messages after foreground, forcing refresh`)
              refresh({ forceRefresh: true, silent: false })
            } else if (!messages || messages.length === 0) {
              console.log(`🔄 [CHAT] No messages loaded after foreground, refreshing`)
              refresh({ forceRefresh: true, silent: false })
            } else {
              console.log(`✅ [CHAT] No unread messages, keeping current state`)
            }
          } catch (error) {
            console.error('❌ [CHAT] Error checking unread count on foreground:', error)
            // Fallback to standard refresh
            refresh({ forceRefresh: false, silent: true })
          }
        }
        
        // Small delay to ensure app is fully active
        setTimeout(checkAndRefresh, 500)
      }
    }

    const subscription = AppState.addEventListener('change', handleAppStateChange)
    
    return () => {
      subscription?.remove()
    }
  }, [currentUser?.id, otherUserId, refresh, messages])

  // Track previous messages to detect new messages and auto-scroll to them
  const prevMessagesLengthRef = useRef(0)
  const prevLastMessageIdRef = useRef(null)
  const messagesLastFetch = useRef(Date.now()) // Track last fetch time - initialized with mount time to avoid immediate refresh
  
  useEffect(() => {
    try {
      if (messages && messages.length > 0) {
        const lastIndex = messages.length - 1
        const prevLength = prevMessagesLengthRef.current
        const currentLastMessageId = messages[lastIndex]?.id
        const prevLastMessageId = prevLastMessageIdRef.current
        
        // Enhanced detection for new messages in sliding window
        const isNewMessage = (prevLength > 0 && messages.length > prevLength) || 
                            (prevLastMessageId && currentLastMessageId && prevLastMessageId !== currentLastMessageId)
        const isInitialLoad = currentIndex === -1 // First time setting the index
        
        console.log(`🎯 [CHAT] Position update - messages: ${messages.length}, lastIndex: ${lastIndex}, prevLength: ${prevLength}, isNewMessage: ${isNewMessage}, isInitialLoad: ${isInitialLoad}, prevLastId: ${prevLastMessageId}, currentLastId: ${currentLastMessageId}`)
        
        if (isInitialLoad) {
          // Initial load - set to last message
          console.log(`🎯 [CHAT] Initial position set to last message at index ${lastIndex}`)
          carouselTranslateX.value = -lastIndex * width
          setCurrentIndex(lastIndex)
        } else if (isNewMessage) {
          // New message added - follow to the very latest message
          // Fix: jump directly to lastIndex even if more than one message was appended
          if (currentIndex !== lastIndex) {
            console.log(`🎯 [CHAT] New message detected! Jumping to latest index ${lastIndex} from ${currentIndex}`)
            carouselTranslateX.value = withSpring(-lastIndex * width, { damping: 20, stiffness: 200, mass: 0.8 })
            setCurrentIndex(lastIndex)
          }
        }
        
        // Update the previous length and last message ID references
        prevMessagesLengthRef.current = messages.length
        prevLastMessageIdRef.current = currentLastMessageId
      }
    } catch (error) {
      console.error('❌ [CHAT] Error setting carousel position:', error)
    }
  }, [messages, width, carouselTranslateX, currentIndex])

  // Only mark as viewed after the user swipes away, opens camera, or navigates away
  const prevIndexRef = useRef(null)
  useEffect(() => {
    try {
      if (!messages || messages.length === 0 || !currentUser) return

      // Only mark as viewed if index actually changed (user swiped)
      if (prevIndexRef.current !== null && prevIndexRef.current !== currentIndex) {
        const prevIndex = prevIndexRef.current
        if (prevIndex >= 0 && prevIndex < messages.length) {
          const prevMessage = messages[prevIndex]
          if (prevMessage && prevMessage.view_once && !oneTimeViewService.isViewed(prevMessage.id)) {
            // Mark message as viewed by starting and then stopping the viewing session
            oneTimeViewService.startViewing(prevMessage.id, currentUser.id, prevMessage).then(async (started) => {
              if (started) {
                console.log('👁️ [CHAT] Started viewing one-time message, now stopping to mark as viewed:', prevMessage.id)
                await oneTimeViewService.stopViewing(prevMessage.id, currentUser.id)
                updateBlurStates()
              }
            }).catch(error => {
              console.error('❌ [CHAT] Error marking one-time message as viewed:', error)
            })
          }
        }
      }

      // Mark as seen for current message (for read receipts, not one-time viewing)
      // Send read receipt only when user actually views the message AND the media is rendered
      // Skip auto-marking when screen initially loads - only mark when user actually swipes
      if (currentIndex >= 0 && currentIndex < messages.length && hasUserInteracted) {
        const currentMessage = messages[currentIndex]
        if (currentMessage && !userViewedMessages.has(currentMessage.id)) {
          // Mark as actually viewed by user interaction
          setUserViewedMessages(prev => {
            const updated = new Set(prev)
            updated.add(currentMessage.id)
            AsyncStorage.setItem('userViewedMessages', JSON.stringify([...updated])).catch(console.error)
            // Also update the unread count service
            unreadCountService.markMessageAsUserViewed(currentMessage.id)
            return updated
          })
          
          // Also update the legacy viewedMessages for compatibility
          setViewedMessages(prev => {
            const updated = new Set(prev)
            updated.add(currentMessage.id)
            AsyncStorage.setItem('viewedMessages', JSON.stringify([...updated])).catch(console.error)
            return updated
          })
          
          // Send read receipt only if message is from other user, not seen, AND media is rendered
          const isMediaRendered = renderedMessages.has(currentMessage.id)
          if (currentMessage.sender_id === otherUserId && 
              currentMessage.seen !== true && 
              isMediaRendered) {
            console.log('📖 [CHAT] User actually viewed rendered message, marking as read:', currentMessage.id);
            markSpecificMessageAsRead(currentMessage);
          } else if (currentMessage.sender_id === otherUserId && currentMessage.seen !== true) {
            console.log('📖 [CHAT] User viewed message but media not yet rendered, waiting:', currentMessage.id);
          }
        }
      } else if (currentIndex >= 0 && currentIndex < messages.length && !hasUserInteracted) {
        console.log('📖 [CHAT] Initial screen load - not marking message as viewed until user swipes');
      }      prevIndexRef.current = currentIndex
    } catch (error) {
      console.error('❌ [CHAT] Error in message viewing effect:', error)
    }
  }, [currentIndex, messages, currentUser, viewedMessages, renderedMessages, hasUserInteracted, userViewedMessages, markSpecificMessageAsRead, otherUserId])

  // Send read receipt when media finishes rendering for already-viewed messages
  useEffect(() => {
    if (!messages?.length || !currentUser?.id || !otherUserId || currentIndex < 0) return;

    const currentMessage = messages[currentIndex];
    if (!currentMessage) return;

    // If current message is actually viewed by user interaction but we haven't sent read receipt yet because media wasn't rendered
    const isUserViewed = userViewedMessages.has(currentMessage.id);
    const isRendered = renderedMessages.has(currentMessage.id);
    const needsReadReceipt = currentMessage.sender_id === otherUserId && currentMessage.seen !== true;

    if (isUserViewed && isRendered && needsReadReceipt) {
      console.log('📖 [CHAT] Media rendered for user-viewed message, sending read receipt:', currentMessage.id);
      markSpecificMessageAsRead(currentMessage);
    }
  }, [renderedMessages, userViewedMessages, currentIndex, messages, currentUser?.id, otherUserId, markSpecificMessageAsRead])

  // Auto-mark current message as viewed after user spends time looking at it (1 second)
  useEffect(() => {
    if (!messages?.length || !currentUser?.id || currentIndex < 0 || hasUserInteracted) return;
    
    const currentMessage = messages[currentIndex];
    if (!currentMessage || currentMessage.sender_id !== otherUserId || currentMessage.seen === true) return;
    
    // Set a timer to mark the message as viewed if user stays on it for 1 second
    const timer = setTimeout(() => {
      console.log('📖 [CHAT] User viewed message for 1 second, marking as viewed:', currentMessage.id);
      setUserViewedMessages(prev => {
        const updated = new Set(prev);
        updated.add(currentMessage.id);
        AsyncStorage.setItem('userViewedMessages', JSON.stringify([...updated])).catch(console.error);
        return updated;
      });
      
      // If media is already rendered, send read receipt immediately
      if (renderedMessages.has(currentMessage.id)) {
        markSpecificMessageAsRead(currentMessage);
      }
    }, 1000); // 1 second

    return () => clearTimeout(timer);
  }, [currentIndex, messages, currentUser?.id, otherUserId, hasUserInteracted, renderedMessages, userViewedMessages, markSpecificMessageAsRead])

  // P1 FIX: Remove additional auto-marking logic - will be handled by batch read receipts
  // Additional effect to ensure messages are marked as read when screen is focused
  // This handles cases where the sliding window refreshes but the user doesn't scroll
  useEffect(() => {
    // P1 FIX: Removed per-message auto-marking. Will be handled by batch read receipts.
    // This prevents the triple GET+PATCH pattern seen in logs.
  }, [messages, currentIndex, currentUser]) // Reduced dependencies

  // Remove automatic batch read receipts when messages change
  // Read receipts will only be sent when user actually views messages by swiping to them
  useEffect(() => {
    // Removed automatic batch read marking - read receipts now only sent when user views message
    console.log('📝 [CHAT] Messages updated - read receipts will be sent when user views each message');
    
    // Log unread count for debugging
    if (currentUser?.id && otherUserId) {
      unreadCountService.getUnreadCountForConversation(currentUser.id, otherUserId)
        .then(unreadCount => {
          console.log(`📊 [CHAT] Unviewed message count: ${unreadCount}`);
        })
    }
  }, [messages, currentUser?.id, otherUserId])

  useEffect(() => {
    async function loadViewedMessages() {
      try {
        const persistentViews = await AsyncStorage.getItem('viewedMessages')
        if (persistentViews) {
          setViewedMessages(new Set(JSON.parse(persistentViews)))
        }
        
        // Load user-actually-viewed messages
        const userViewed = await AsyncStorage.getItem('userViewedMessages')
        if (userViewed) {
          setUserViewedMessages(new Set(JSON.parse(userViewed)))
        }
      } catch (error) {
        console.error('❌ [CHAT] Error loading viewed messages:', error)
      }
    }
    loadViewedMessages()
    
    // Initialize services
    unreadCountService.init()
    oneTimeViewService.init()
    nsfwViewService.init()
    backgroundMessageService.init()
  }, [])

  // Clean up rendered messages when messages change to prevent memory leaks
  useEffect(() => {
    if (messages && messages.length > 0) {
      const currentMessageIds = new Set(messages.map(m => m.id))
      setRenderedMessages(prev => {
        const filtered = new Set([...prev].filter(messageId => currentMessageIds.has(messageId)))
        return filtered
      })
      setNsfwVideoDurations(prev => {
        const filtered = Object.fromEntries(
          Object.entries(prev).filter(([messageId]) => currentMessageIds.has(messageId))
        )
        return filtered
      })
    }
  }, [messages])

  // Sync one-time view service and update blur states ONCE after initial message load
  const didInitialSyncRef = useRef(false)
  useEffect(() => {
    if (!didInitialSyncRef.current && messages && messages.length > 0 && currentUser) {
      oneTimeViewService.loadAndSyncMessages(messages, currentUser.id)
        .then(() => {
          updateBlurStates()
          didInitialSyncRef.current = true
        })
        .catch(error => console.error('❌ [CHAT] Failed to sync one-time messages:', error))
    }
  }, [messages, currentUser])

  // Update blur states when current index changes (to unblur currently viewed message)
  useEffect(() => {
    if (messages && messages.length > 0 && currentUser && currentIndex >= 0) {
      updateBlurStates()
    }
  }, [currentIndex])

  // Start viewing one-time messages when current message changes to a one-time message
  useEffect(() => {
    if (!messages || messages.length === 0 || currentIndex < 0 || currentIndex >= messages.length || !currentUser) {
      return
    }

    const currentMessage = messages[currentIndex]
    
    // Safety check - ensure we have a valid message
    if (!currentMessage || !currentMessage.id) {
      return
    }

    // Start viewing one-time message if it's not already viewed and not already being viewed
    if (currentMessage.view_once && 
        currentMessage.receiver_id === currentUser.id && 
        !oneTimeViewService.isViewed(currentMessage.id) &&
        !oneTimeViewService.isCurrentlyViewing(currentMessage.id)) {
      oneTimeViewService.startViewing(currentMessage.id, currentUser.id, currentMessage).then((started) => {
        if (started) {
          console.log('👁️ [CHAT] Started viewing one-time message:', currentMessage.id)
          // Update blur states to remove blur from currently viewed message
          updateBlurStates()
        }
      }).catch(error => {
        console.error('❌ [CHAT] Error starting one-time message viewing:', error)
      })
    }
  }, [currentIndex, messages, currentUser])

  // Start NSFW timer when current message changes to an NSFW message
  useEffect(() => {
    if (!messages || messages.length === 0 || currentIndex < 0 || currentIndex >= messages.length) {
      return
    }

    const currentMessage = messages[currentIndex]
    
    // Safety check - ensure we have a valid message
    if (!currentMessage || !currentMessage.id) {
      return
    }

    // Don't start timer if a message is currently being removed
    if (removingMessageId) {
      console.log(`🛑 [NSFW] Message removal in progress, skipping timer start`)
      return
    }

    if (currentMessage.is_nsfw && currentMessage.receiver_id === currentUser?.id) {
      // Only show tap-to-view if not already viewed and not currently viewing/timing
      if (!nsfwViewService.isViewed(currentMessage.id) && 
          !nsfwViewService.isCurrentlyViewing(currentMessage.id) &&
          !nsfwTimerState.isActive) {
        console.log(`🔥 [NSFW] Current message is NSFW, showing tap-to-view: ${currentMessage.id}`)
        setNsfwTapToViewState({
          messageId: currentMessage.id,
          isWaiting: true
        })
      }
    } else {
      // Clear tap-to-view state if we moved away
      if (nsfwTapToViewState.isWaiting) {
        setNsfwTapToViewState({
          messageId: null,
          isWaiting: false
        })
      }
    }
  }, [currentIndex, messages, currentUser, handleNsfwTimer, stopNsfwTimer, nsfwTimerState.isActive, nsfwTimerState.messageId, removingMessageId])

  // Track the message currently being viewed (by id) and if it was actually visible
  const currentlyViewingIdRef = useRef(null)
  const hasBeenViewedRef = useRef(false)

  // On index change, if the previous message was a one-time and not yet viewed, mark as viewed (only on swipe away)
  useEffect(() => {
    if (!messages || messages.length === 0 || !currentUser) return

    // Only mark as viewed if index actually changed (user swiped) and the message was actually visible
    if (
      currentlyViewingIdRef.current !== null &&
      currentlyViewingIdRef.current !== messages[currentIndex]?.id &&
      hasBeenViewedRef.current
    ) {
      const prevMessage = messages.find(m => m.id === currentlyViewingIdRef.current)
      if (prevMessage && prevMessage.view_once && !oneTimeViewService.isViewed(prevMessage.id)) {
        // Optimistically blur the message immediately (fake blur)
        setOptimisticBlurredMessages(prev => {
          const updated = new Set(prev)
          updated.add(prevMessage.id)
          return updated
        })
        oneTimeViewService.startViewing(prevMessage.id, currentUser.id, prevMessage).then(async (started) => {
          // Remove from optimisticBlurredMessages when backend confirms
          setOptimisticBlurredMessages(prev => {
            const updated = new Set(prev)
            updated.delete(prevMessage.id)
            return updated
          })
          if (started) {
            console.log('👁️ [CHAT] Started viewing one-time message, now stopping to mark as viewed after swipe:', prevMessage.id)
            await oneTimeViewService.stopViewing(prevMessage.id, currentUser.id)
            updateBlurStates()
          }
        })
      }
    }
    // Update the ref to the current message id
    currentlyViewingIdRef.current = messages[currentIndex]?.id
    hasBeenViewedRef.current = true // Mark as viewed since user is now seeing this message
  }, [currentIndex, messages, currentUser])

  // Only update blur states after user action, not on every message load
  // Remove unnecessary reset of currentlyViewingIdRef and hasBeenViewedRef on every message change
  // Only updateBlurStates is called after user action (swipe, camera, navigation)

  // On navigation away, handle both one-time and NSFW messages
  useEffect(() => {
    return () => {
      // Handle NSFW timers - only stop if timer is active and not in removal process
      if (nsfwTimerState.isActive && nsfwTimerState.messageId && !removingMessageId) {
        console.log(`🛑 [NSFW] Navigation away - stopping NSFW timer for ${nsfwTimerState.messageId}`)
        nsfwViewService.stopViewing(nsfwTimerState.messageId, true, currentUser?.id)
          .catch(error => {
            console.error('❌ [NSFW] Error stopping timer on navigation away:', error)
          })
      }

      // For one-time messages, we don't mark them as viewed on navigation away
      // They should only be marked as viewed when the user actively swipes away from them
      console.log('🔄 [CHAT] Screen unmounting - NSFW timers stopped, one-time messages left as-is')
    }
  }, [nsfwTimerState.isActive, nsfwTimerState.messageId, removingMessageId, currentUser])

  // Auto-hide hint with animation
  useEffect(() => {
    if (showCameraHint) {
      const timer = setTimeout(() => {
        hintOpacity.value = withSpring(0, { duration: 1000 })
        setTimeout(() => {
          setShowCameraHint(false)
        }, 1000)
      }, 3000) // Show for 3 seconds then fade out over 1 second
      
      return () => clearTimeout(timer)
    }
  }, [showCameraHint, hintOpacity])

  // Track if we need to jump to the latest message after an optimistic send
  const pendingJumpToEndRef = useRef(false)

  // Listen for background message service events
  useEffect(() => {
    const handleOptimisticMessageAdded = (data) => {
      if (data.receiverId === otherUserId) {
        console.log('📤 [CHAT] Optimistic message added, auto-updating via combinedMessages')
        // Mark that we should jump to the latest on the next messages update
        pendingJumpToEndRef.current = true
      }
    }

    const handleMessageStatusUpdate = (data) => {
      console.log('🔄 [CHAT] Message status update:', data.status, data.tempId)
      // Optimistic messages automatically update their status - no refresh needed
    }

    const handleOptimisticMessageReplaced = (data) => {
      console.log('✅ [CHAT] Optimistic message replaced with real message:', data.tempId, '->', data.realMessage?.id)
      // Don't force refresh - let combinedMessages handle deduplication automatically
      // The optimistic update counter will trigger the necessary re-render
    }

    // Subscribe to events
    backgroundMessageService.on('optimisticMessageAdded', handleOptimisticMessageAdded)
    backgroundMessageService.on('messageStatusUpdate', handleMessageStatusUpdate)
    backgroundMessageService.on('optimisticMessageReplaced', handleOptimisticMessageReplaced)

    // Cleanup
    return () => {
      backgroundMessageService.off('optimisticMessageAdded', handleOptimisticMessageAdded)
      backgroundMessageService.off('messageStatusUpdate', handleMessageStatusUpdate)
      backgroundMessageService.off('optimisticMessageReplaced', handleOptimisticMessageReplaced)
    }
  }, [otherUserId, refresh])

  // Jump to the newest message immediately after an optimistic send
  useEffect(() => {
    // Nothing to do if no messages
    if (!messages || messages.length === 0) return

    // If a previous handler requested a jump, execute it now
    if (pendingJumpToEndRef.current) {
      const lastIndex = messages.length - 1
      console.log(`⚡ [CHAT] Jumping to newest message immediately at index ${lastIndex}`)
      carouselTranslateX.value = withSpring(-lastIndex * width, { damping: 20, stiffness: 200, mass: 0.8 })
      setCurrentIndex(lastIndex)
      setHasUserInteracted(true) // User sent a message, allow marking as viewed
      // Update blur states now that user has interacted
      updateBlurStates()
      pendingJumpToEndRef.current = false
    }
  }, [messages?.length, width, carouselTranslateX])

  // 8. ALWAYS call all useCallback hooks - NEVER conditionally
  const goBack = useCallback(async () => {
    console.log('🟣 [TRACE] goBack');
    // Stop NSFW timer if active - this will mark the NSFW message as viewed
    if (messages && messages.length > 0 && currentUser && currentIndex >= 0) {
      const currentMessage = messages[currentIndex]
      if (currentMessage) {
        if (currentMessage.is_nsfw && nsfwTimerState.isActive && nsfwTimerState.messageId === currentMessage.id) {
          console.log(`🛑 [NSFW] Going back - removing active NSFW ${currentMessage.id}`)
          try {
            await handleNsfwMessageRemoval(currentMessage.id, currentIndex, true /* skipNavigation */)
          } catch (_) {
            try { await nsfwViewService.stopViewing(currentMessage.id, true, currentUser?.id) } catch (_) {}
          }
        }

        // NEW: Mark one-time message as viewed when leaving via vertical swipe (down)
        if (
          currentMessage.view_once &&
          currentMessage.receiver_id === currentUser.id &&
          !oneTimeViewService.isViewed(currentMessage.id)
        ) {
          try {
            // Ensure a viewing session exists, then stop to mark as viewed
            if (!oneTimeViewService.isCurrentlyViewing(currentMessage.id)) {
              await oneTimeViewService.startViewing(currentMessage.id, currentUser.id, currentMessage)
            }
            await oneTimeViewService.stopViewing(currentMessage.id, currentUser.id)
            updateBlurStates()
            console.log('👁️ [CHAT] Marked one-time message as viewed on goBack:', currentMessage.id)
          } catch (e) {
            console.error('❌ [CHAT] Error marking one-time message viewed on goBack:', e)
          }
        }
      }
    }
    router.back()
  }, [messages, currentUser, currentIndex, nsfwTimerState.isActive, nsfwTimerState.messageId, stopNsfwTimer])

  const openCamera = useCallback(async () => {
    console.log('🟣 [TRACE] openCamera');
    if (!otherUser) return

    // Fix for camera freezing: ensure we fully stop any playing video by setting shouldPlay to false
    // This will force all videos to stop and release hardware resources before opening the camera
    try {
      console.log(`🎬 [VIDEO] Ensuring all videos are stopped before opening camera`)
      
      // Set a global state to indicate videos should stop
      // This will be detected by videos in the useEffect cleanup function
      global._isNavigatingToCamera = true
      // Proactively unmount media so player resources are released before camera starts
      setSuspendMedia(true)
      
      // Force a small delay to ensure videos stop playing and resources are released
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.log('🎬 [VIDEO] Error pausing videos:', error);
    }

    // Stop NSFW timer if active - this will mark the NSFW message as viewed
    if (messages && messages.length > 0 && currentUser && currentIndex >= 0) {
      const currentMessage = messages[currentIndex]
      if (currentMessage) {
        if (currentMessage.is_nsfw && nsfwTimerState.isActive && nsfwTimerState.messageId === currentMessage.id) {
          console.log(`🛑 [NSFW] Opening camera - removing active NSFW ${currentMessage.id}`)
          try {
            await handleNsfwMessageRemoval(currentMessage.id, currentIndex, true /* skipNavigation */)
          } catch (_) {
            try { await nsfwViewService.stopViewing(currentMessage.id, true, currentUser?.id) } catch (_) {}
          }
        }
        // NEW: Mark one-time message as viewed when leaving via vertical swipe (up to camera)
        if (
          currentMessage.view_once &&
          currentMessage.receiver_id === currentUser.id &&
          !oneTimeViewService.isViewed(currentMessage.id)
        ) {
          try {
            if (!oneTimeViewService.isCurrentlyViewing(currentMessage.id)) {
              await oneTimeViewService.startViewing(currentMessage.id, currentUser.id, currentMessage)
            }
            await oneTimeViewService.stopViewing(currentMessage.id, currentUser.id)
            updateBlurStates()
            console.log('👁️ [CHAT] Marked one-time message as viewed on openCamera:', currentMessage.id)
          } catch (e) {
            console.error('❌ [CHAT] Error marking one-time message viewed on openCamera:', e)
          }
        }
      }
    }

    // Add another small delay before navigation to ensure cleanup happens
    await new Promise(resolve => setTimeout(resolve, 50));
    // Proactively reset the camera overlay so it doesn't stick after returning
    try {
      cameraOverlayProgress.value = 0
    } catch (_) {}
    
    router.push({
      pathname: '/camera',
      params: {
        otherUser: JSON.stringify(otherUser),
        returnTo: 'chat'
      }
    })
    
    // Reset state after navigation is triggered
    setTimeout(() => {
      global._isNavigatingToCamera = false
    }, 2000)
  }, [otherUser, messages, currentUser, currentIndex, nsfwTimerState.isActive, nsfwTimerState.messageId, stopNsfwTimer])

  // Resume media when chat screen regains focus
  useFocusEffect(
    useCallback(() => {
      setSuspendMedia(false)
      // Ensure camera overlay is reset when returning to chat
      try {
        cameraOverlayProgress.value = 0
      } catch (_) {}
      return () => {}
    }, [])
  )

  // 9. ALWAYS call useMemo for gestures - NEVER conditionally
  const horizontalPanGesture = useMemo(() => {
    const currentMsg = (messages && currentIndex >= 0) ? messages[currentIndex] : null
    const nsfwBlocked = !!(nsfwTimerState.isActive && nsfwTimerState.messageId === currentMsg?.id && currentMsg?.is_nsfw && currentMsg?.receiver_id === currentUser?.id)
    return Gesture.Pan().enabled(!nsfwBlocked)
      .onUpdate((event) => {
        try {
          if (!messages || messages.length === 0 || removingMessageId || currentIndex < 0) return
          // Block horizontal swipes while viewing an active NSFW message (clean UX)
          try {
            const currentMsg = messages[currentIndex]
            const nsfwBlocked = !!(nsfwTimerState.isActive && nsfwTimerState.messageId === currentMsg?.id && currentMsg?.is_nsfw && currentMsg?.receiver_id === currentUser?.id)
            if (nsfwBlocked) {
              carouselTranslateX.value = -currentIndex * width
              return
            }
          } catch (_) {}
          // Only handle horizontal swipes for carousel navigation
          if (Math.abs(event.translationX) > Math.abs(event.translationY)) {
            // SAFETY: Validate position calculation for small conversations
            const expectedPosition = -currentIndex * width
            const newTranslateX = expectedPosition + event.translationX
            
            // Bound checking for small conversations to prevent visual glitches
            const maxTranslateX = 0 // First message (index 0) position
            const minTranslateX = -(messages.length - 1) * width // Last message position
            const boundedTranslateX = Math.min(maxTranslateX, Math.max(minTranslateX, newTranslateX))
            
            carouselTranslateX.value = boundedTranslateX
          }
        } catch (error) {
          console.error('❌ [GESTURE] Error in horizontal pan update:', error)
        }
      })
      .onEnd((event) => {
        try {
          if (!messages || messages.length === 0 || removingMessageId || currentIndex < 0) return
          // Block end handling if NSFW viewing is active on current message
          try {
            const currentMsg = messages[currentIndex]
            const nsfwBlocked = !!(nsfwTimerState.isActive && nsfwTimerState.messageId === currentMsg?.id && currentMsg?.is_nsfw && currentMsg?.receiver_id === currentUser?.id)
            if (nsfwBlocked) {
              carouselTranslateX.value = withSpring(-currentIndex * width, {
                damping: 20,
                stiffness: 200,
                mass: 0.8
              })
              return
            }
          } catch (_) {}
          
          const velocity = event.velocityX
          const translationX = event.translationX
          const translationY = event.translationY
          
          // Check if this is primarily a horizontal gesture
          if (Math.abs(translationX) > Math.abs(translationY)) {
            console.log(`🎯 [GESTURE] Horizontal pan ended - translationX: ${translationX}, velocityX: ${velocity}, currentIndex: ${currentIndex}, messagesLength: ${messages.length}`)
            let newIndex = currentIndex
            
            // CONSISTENCY FIX: Adjust gesture sensitivity based on message count
            // For small conversations (<= 3 messages), use slightly higher thresholds to prevent accidental swipes
            const isSmallConversation = messages.length <= 3
            const translationThreshold = isSmallConversation ? width * 0.4 : width * 0.3
            const velocityThreshold = isSmallConversation ? 600 : 500
            
            if (translationX > translationThreshold || velocity > velocityThreshold) {
              newIndex = Math.max(0, currentIndex - 1)
            } else if (translationX < -translationThreshold || velocity < -velocityThreshold) {
              newIndex = Math.min(messages.length - 1, currentIndex + 1)
            }
            
            // BOUNDARY FEEDBACK: For small conversations, provide subtle feedback at boundaries
            if (messages.length <= 5) {
              if ((currentIndex === 0 && newIndex === 0 && translationX > 0) || 
                  (currentIndex === messages.length - 1 && newIndex === messages.length - 1 && translationX < 0)) {
                // At boundary in small conversation - add subtle spring back effect
                console.log(`🎯 [GESTURE] Boundary reached in small conversation (${messages.length} messages)`)
              }
            }
            
            // Navigate normally
            console.log(`🎯 [GESTURE] Moving from index ${currentIndex} to ${newIndex} (${messages.length} total messages)`)
            carouselTranslateX.value = withSpring(-newIndex * width, {
              damping: 20,
              stiffness: 200,
              mass: 0.8
            })
            runOnJS(setCurrentIndex)(newIndex)
            runOnJS(setHasUserInteracted)(true) // Mark that user has actually swiped
            // Update blur states now that user has interacted
            runOnJS(updateBlurStatesRef.current)
          } else {
            // Reset carousel position if not horizontal swipe
            carouselTranslateX.value = withSpring(-currentIndex * width, {
              damping: 20,
              stiffness: 200,
              mass: 0.8
            })
          }
        } catch (error) {
          console.error('❌ [GESTURE] Error in horizontal pan end:', error)
          // Reset carousel position on error
          try {
            carouselTranslateX.value = withSpring(-currentIndex * width, {
              damping: 20,
              stiffness: 200,
              mass: 0.8
            })
          } catch (resetError) {
            console.error('❌ [GESTURE] Error resetting carousel position:', resetError)
          }
        }
      })
  }, [currentIndex, messages, width, carouselTranslateX, nsfwTimerState.isActive, nsfwTimerState.messageId, currentUser, removingMessageId])

  const verticalPanGesture = useMemo(() => {
    return Gesture.Pan()
      .onUpdate((event) => {
        try {
          if (removingMessageId) return // Don't handle vertical gestures during removal
          
          const translationY = event.translationY
          const translationX = event.translationX
          
          // Only handle vertical gestures
          if (Math.abs(translationY) > Math.abs(translationX)) {
            // Downward: drag screen down slightly (return home affordance)
            if (translationY > 0) {
              screenTranslateY.value = translationY
              // Scale down slightly as user swipes down for visual feedback
              const scale = interpolate(
                translationY,
                [0, height * 0.3],
                [1, 0.95],
                Extrapolate.CLAMP
              )
              screenScale.value = scale
              // Hide camera overlay when dragging down
              cameraOverlayProgress.value = withTiming(0, { duration: 100 })
            } else {
              // Upward: reveal camera overlay progressively
              const up = Math.abs(translationY)
              const threshold = Math.max(120, height * 0.25)
              const progress = Math.min(up / threshold, 1)
              cameraOverlayProgress.value = progress
              // Ensure screen base transform on upward drag
              screenTranslateY.value = 0
              screenScale.value = 1
            }
          }
        } catch (error) {
          console.error('❌ [GESTURE] Error in vertical pan update:', error)
        }
      })
      .onEnd((event) => {
        try {
          if (removingMessageId) return // Don't handle vertical gestures during removal
          
          const translationY = event.translationY
          const velocityY = event.velocityY
          
          // Check if this is primarily a vertical gesture
          if (Math.abs(translationY) > Math.abs(event.translationX)) {
            console.log(`🎯 [GESTURE] Vertical pan ended - translationY: ${translationY}, velocityY: ${velocityY}`)
            
            // Swipe up to open camera
            if (translationY < -height * 0.2 || velocityY < -500) {
              console.log(`🎯 [GESTURE] Swipe up detected - opening camera`)
              // Fill overlay briefly for feedback
              cameraOverlayProgress.value = withTiming(1, { duration: 80 })
              // Reset screen position first
              screenTranslateY.value = withSpring(0)
              screenScale.value = withSpring(1)
              runOnJS(openCamera)()
            }
            // Swipe down to go back with threshold
            else if (translationY > height * 0.25 || velocityY > 800) {
              console.log(`🎯 [GESTURE] Swipe down detected - going back with smooth animation`)
              // Animate screen sliding down and scaling
              screenScale.value = withTiming(0.9, { duration: 200 })
              screenTranslateY.value = withTiming(height, { duration: 200 })
              // Hide any camera overlay
              cameraOverlayProgress.value = withTiming(0, { duration: 120 })
              // Navigate immediately without waiting for animation
              runOnJS(goBack)()
            } else {
              // Snap back to original position
              screenTranslateY.value = withSpring(0)
              screenScale.value = withSpring(1)
              cameraOverlayProgress.value = withTiming(0, { duration: 150 })
            }
          }
        } catch (error) {
          console.error('❌ [GESTURE] Error in vertical pan end:', error)
          // Reset screen position on error
          try {
            screenTranslateY.value = withSpring(0)
            screenScale.value = withSpring(1)
            cameraOverlayProgress.value = withTiming(0, { duration: 150 })
          } catch (resetError) {
            console.error('❌ [GESTURE] Error resetting screen position:', resetError)
          }
        }
      })
  }, [openCamera, goBack, screenTranslateY, screenScale, removingMessageId])

  const combinedGesture = useMemo(() => {
    return Gesture.Simultaneous(horizontalPanGesture, verticalPanGesture)
  }, [horizontalPanGesture, verticalPanGesture])

  // 9. ALWAYS call useAnimatedStyle - NEVER conditionally
  const animatedCarouselStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: carouselTranslateX.value }]
  }), [])

  const animatedHintStyle = useAnimatedStyle(() => ({
    opacity: hintOpacity.value,
    transform: [{ translateY: (1 - hintOpacity.value) * 20 }]
  }), [])

  const animatedScreenStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: screenTranslateY.value },
      { scale: screenScale.value }
    ]
  }), [])

  // Animated style for camera swipe-up overlay
  const animatedCameraOverlayStyle = useAnimatedStyle(() => {
    const opacity = cameraOverlayProgress.value
    const translateY = interpolate(cameraOverlayProgress.value, [0, 1], [40, 0], Extrapolate.CLAMP)
    return {
      opacity,
      transform: [{ translateY }]
    }
  }, [])

  // ENHANCED: Calculate display index with better validation for small conversations
  const displayIndex = useMemo(() => {
    if (!messages || messages.length === 0) return 0
    
    if (currentIndex >= 0) {
      // Validate current index is within bounds
      const validIndex = Math.min(Math.max(0, currentIndex), messages.length - 1)
      if (validIndex !== currentIndex && __DEV__) {
        console.warn(`🚨 [DISPLAY] currentIndex ${currentIndex} out of bounds for ${messages.length} messages, using ${validIndex}`)
      }
      return validIndex
    }
    
    // Fallback to last message
    return messages.length - 1
  }, [currentIndex, messages])

  // ALL HOOKS CALLED - NOW WE CAN DO CONDITIONAL RENDERING

  // Show loading only when we truly have no messages yet AND we're actually loading
  // Avoid showing loading if we have cached data or if we're just refreshing
  const shouldShowLoading = loading && (!messages || messages.length === 0) && !rawMessages
  
  if (shouldShowLoading) {
    return (
      <Animated.View style={[styles.loadingContainer, animatedScreenStyle]}>
        <ExpoStatusBar style="light" />
        <Text style={styles.loadingText}>Chargement...</Text>
      </Animated.View>
    )
  }

  // Error state
  if (error) {
    return (
      <Animated.View style={[styles.errorContainer, animatedScreenStyle]}>
        <ExpoStatusBar style="light" />
        <Text style={styles.errorText}>Erreur de chargement</Text>
        <TouchableOpacity style={styles.retryButton} onPress={refresh}>
          <Text style={styles.retryText}>Réessayer</Text>
        </TouchableOpacity>
      </Animated.View>
    )
  }

  // Empty state
  if (!messages || messages.length === 0) {
    return (
      <Animated.View style={[styles.container, animatedScreenStyle]}>
        <ExpoStatusBar style="light" />
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerButton} onPress={goBack}>
            <Ionicons name="chevron-back" size={24} color={Colors.white} />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle}>{otherUser?.pseudo || 'Chat'}</Text>
            {__DEV__ && isWindowFull && (
              <Text style={styles.slidingWindowIndicator}>
                Fenêtre glissante: {messages.length}/{windowSize}
              </Text>
            )}
          </View>
          <View style={styles.headerButton} />
        </View>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Aucun message</Text>
          <TouchableOpacity style={styles.cameraButton} onPress={openCamera}>
            <Ionicons name="camera" size={24} color={Colors.white} />
            <Text style={styles.cameraButtonText}>Prendre une photo</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    )
  }

  // Main interface - Full screen with gesture navigation
  
  return (
    <Animated.View style={[styles.container, animatedScreenStyle]}>
      <ExpoStatusBar style="light" />
      
      {/* Loading overlay for notification navigation */}
      {isLoadingFromNotification && (
        <View style={styles.notificationLoadingOverlay}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.notificationLoadingText}>
            Preparing media...
          </Text>
        </View>
      )}
      
      {/* Full screen messages container */}
      <View style={styles.fullScreenMessagesContainer}>
        <GestureDetector gesture={combinedGesture}>
          <Animated.View
            style={[styles.carousel, animatedCarouselStyle]}
          >
            {messages.map((message, index) => {
              // ENHANCED: Generate stable keys that persist through optimistic → real message transitions
              // Better handling for small conversations and edge cases
              const getStableKey = (msg) => {
                // Priority 1: Real message with stable ID (most reliable)
                if (msg.id && !msg._isSending) {
                  return `real-${msg.id}`;
                } 
                
                // Priority 2: Message with tempId reference (optimistic or replacement)
                if (msg._tempId) {
                  return `temp-${msg._tempId}`;
                } 
                
                // Priority 3: Optimistic message with tempId
                if (msg.tempId) {
                  return `optimistic-${msg.tempId}`;
                } 
                
                // Priority 4: Optimistic message without tempId (use content-based key for small conversations)
                if (msg._isSending) {
                  const contentHash = typeof msg.content === 'string' 
                    ? msg.content.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '') 
                    : 'media';
                  return `sending-${msg.sender_id}-${contentHash}-${msg.created_at?.slice(-6) || index}`;
                } 
                
                // Final fallback - should rarely be used
                return `msg-${msg.id || `fallback-${index}`}`;
              };
              
              return (
                <MessageItem
                  key={getStableKey(message)}
                  message={message}
                  index={index}
                  currentIndex={displayIndex}
                  isViewed={viewedMessages.has(message.id)}
                  shouldShowBlur={blurredMessages.has(message.id) || optimisticBlurredMessages.has(message.id)}
                  currentUser={currentUser}
                  otherUser={otherUser}
                  nsfwTimerState={nsfwTimerState}
                  nsfwTapToViewState={nsfwTapToViewState}
                  handleNsfwTapToView={handleNsfwTapToView}
                  handleNsfwMessageRemoval={handleNsfwMessageRemoval}
                  handleMediaRendered={handleMediaRendered}
                  removingMessageId={removingMessageId}
                  suspendMedia={suspendMedia}
                  setNsfwVideoDurations={setNsfwVideoDurations}
                />
              );
            })}
          </Animated.View>
        </GestureDetector>

        {/* Swipe-up camera overlay */}
        <Animated.View pointerEvents="none" style={[styles.cameraSwipeOverlay, animatedCameraOverlayStyle]}>
          <View style={styles.cameraSwipePill}>
            <Ionicons name="camera" size={22} color={Colors.white} />
            <Text style={styles.cameraSwipeText}>Ouvrir la caméra</Text>
          </View>
        </Animated.View>
      </View>

      {/* Floating controls overlay */}
      <View style={styles.floatingControls}>
        {/* Back button - top left */}
        <TouchableOpacity style={styles.floatingBackButton} onPress={goBack}>
          <Ionicons name="chevron-back" size={28} color={Colors.white} />
        </TouchableOpacity>
        
        {/* Right side buttons container */}
        <View style={styles.rightButtonsContainer}>
          {/* Camera button */}
          <TouchableOpacity style={styles.floatingCameraButton} onPress={openCamera}>
            <Ionicons name="camera" size={24} color={Colors.white} />
          </TouchableOpacity>
          
          {/* Report flag button */}
          <TouchableOpacity 
            style={styles.floatingFlagButton} 
            onPress={() => {
              if (!currentUser?.id) {
                Alert.alert('Erreur', 'Vous devez être connecté pour signaler du contenu');
                return;
              }
              if (messages && messages.length > 0) {
                const currentMessage = messages[displayIndex];
                setSelectedMessageForReport(currentMessage);
                setShowReportModal(true);
              }
            }}
          >
            <Ionicons name="flag" size={18} color={Colors.white} />
          </TouchableOpacity>
        </View>
        
        {/* User name - top center */}
        <View style={styles.floatingUserInfo}>
          <Text style={styles.floatingUserName}>{otherUser?.pseudo || 'Chat'}</Text>
        </View>
      </View>

      {/* Gesture hints with auto-fade */}
      {showCameraHint && (
        <Animated.View style={[styles.floatingHintContainer, animatedHintStyle]}>
          <Text style={styles.hintText}>↔️ Messages • ↑ Caméra • ↓ Retour</Text>
        </Animated.View>
      )}

      {/* Report Content Modal */}
      <ReportContentModal
        visible={showReportModal}
        onClose={() => {
          setShowReportModal(false);
          setSelectedMessageForReport(null);
        }}
        message={selectedMessageForReport}
        currentUser={currentUser}
        onSubmit={async (reportData) => {
          try {
            console.log('📧 [CONTENT_REPORT] Submitting content report:', reportData);
            
            // Use the report data directly - it's already in the correct format for the API
            const apiReportData = {
              ...reportData, // This already has the correct format from ReportContentModal
              reportedUser: {
                id: reportData.message.sender_id,
                pseudo: otherUser?.pseudo || 'Utilisateur inconnu'
              }
            };
            
            await ReportEmailService.sendReport(apiReportData);
            console.log('✅ [CONTENT_REPORT] Report submitted successfully');
          } catch (error) {
            console.error('❌ [CONTENT_REPORT] Failed to submit report:', error);
            throw error; // Re-throw so the modal shows error message
          }
        }}
      />
    </Animated.View>
  )
}

// Full Screen Message component - MEMOIZED to prevent infinite re-renders
const MessageItem = React.memo(({ 
  message, 
  index, 
  currentIndex, 
  isViewed, 
  shouldShowBlur, 
  currentUser, 
  otherUser, 
  nsfwTimerState, 
  nsfwTapToViewState,
  handleNsfwTapToView,
  handleNsfwMessageRemoval,
  handleMediaRendered,
  removingMessageId,
  suspendMedia,
  setNsfwVideoDurations
}) => {
  // ALL HOOKS MUST BE CALLED BEFORE ANY EARLY RETURNS - React Rules of Hooks
  
  // Slide-down + fade-out animation when this message is being removed (NSFW video/photo end)
  const removalOpacity = useSharedValue(1)
  const removalTranslateY = useSharedValue(0)
  
  // Memoize callback functions to prevent infinite re-renders
  const onVideoLoad = React.useCallback((player) => {
    if (!message?.id) return;
    if (__DEV__) {
      console.log(`🎥 [CHAT] Video player loaded for message ${message.id}`)
    }
    console.log('🎬 [VIDEO_LOAD] Video loaded for message:', message.id);
    handleMediaRendered?.(message.id);
  }, [message?.id, handleMediaRendered]);

  const onVideoError = React.useCallback((error) => {
    if (!message?.id) return;
    if (__DEV__) {
      console.warn(`❌ [CHAT] Video error for message ${message.id}:`, error)
    }
    console.warn('❌ [VIDEO_LOAD] Video load error for message:', message.id, error);
    // Still mark as rendered even on error to not block read receipts
    handleMediaRendered?.(message.id);
  }, [message?.id, handleMediaRendered]);

  const onDurationLoad = React.useCallback((duration) => {
    if (!message?.id) return;
    console.log(`🎬 [NSFW] Duration loaded for message ${message.id}: ${duration}s`)
    // Store the duration for later use when timer starts
    setNsfwVideoDurations(prev => ({
      ...prev,
      [message.id]: duration
    }))
    // Also call the callback if it's already registered
    if (nsfwTimerState.videoCallbacks?.onDurationLoad) {
      nsfwTimerState.videoCallbacks.onDurationLoad(duration)
    }
  }, [message?.id, setNsfwVideoDurations, nsfwTimerState.videoCallbacks]);

  const onVideoEnd = React.useCallback(() => {
    if (!message?.id) return;
    console.log(`🎬 [COMPONENT] Video ended for message ${message.id} - triggering removal from component`)
    // Directly trigger removal when video ends - same as images
    if (index === currentIndex && isNsfwMessage) {
      console.log(`🎬 [COMPONENT] Video completed, removing message ${message.id} with force=true`)
      handleNsfwMessageRemoval(message.id, index, false, true)
    }
  }, [message?.id, index, currentIndex, isNsfwMessage, handleNsfwMessageRemoval]);

  const onPlaybackStatusUpdate = React.useCallback((status) => {
    try {
      if (!message?.id) return;
      if (index !== currentIndex) return
      if (!nsfwTimerState.isActive || nsfwTimerState.messageId !== message.id) return
      const duration = Math.max(status?.duration || 0, 0)
      const currentTime = Math.max(status?.currentTime || 0, 0)
      if (duration > 0) {
        const progress = Math.min(currentTime / duration, 0.99)
        const timeRemaining = Math.max(duration - currentTime, 0)
        setNsfwVideoDurations(prev => ({
          ...prev,
          progress,
          timeRemaining
        }))
      }
    } catch (e) {
      // No-op: UI update failures should not crash playback
    }
  }, [index, currentIndex, nsfwTimerState.isActive, nsfwTimerState.messageId, message?.id, setNsfwVideoDurations]);
  // Calculate derived state
  const isFromCurrentUser = message?.sender_id === currentUser?.id
  const isCurrentMessage = index === currentIndex
  const isNsfwMessage = message?.is_nsfw && !isFromCurrentUser
  const isRemoving = removingMessageId === message?.id

  // Use unified media type indicator
  const mediaTypeInfo = message ? getMediaTypeInfo(message) : null
  useEffect(() => {
    if (!message?.id) return;
    try {
      console.log(`🎭 [ANIMATION] Animation effect triggered for ${message.id}, isRemoving: ${isRemoving}`)
      if (isRemoving) {
        console.log(`🎭 [ANIMATION] Starting removal animation for ${message.id}`)
        removalOpacity.value = withTiming(0, { duration: 220 })
        removalTranslateY.value = withTiming(Math.max(120, Math.floor(height * 0.25)), { duration: 220 })
      } else {
        console.log(`🎭 [ANIMATION] Starting restore animation for ${message.id}`)
        removalOpacity.value = withTiming(1, { duration: 120 })
        removalTranslateY.value = withTiming(0, { duration: 120 })
      }
    } catch (_) {}
  }, [isRemoving, message?.id, removalOpacity, removalTranslateY]) // Added necessary dependencies
  const removalAnimatedStyle = useAnimatedStyle(() => ({ 
    opacity: removalOpacity.value,
    transform: [{ translateY: removalTranslateY.value }]
  }))

  // Mark text messages as rendered immediately
  useEffect(() => {
    if (message?.id && !message.media_url) {
      console.log('📝 [TEXT_RENDER] Text message rendered:', message.id);
      handleMediaRendered?.(message.id);
    }
  }, [message?.id, message?.media_url, handleMediaRendered]);

  // Memoize source object to prevent VideoPlayerWrapper re-renders  
  const videoSource = React.useMemo(() => ({ uri: message?.media_url }), [message?.media_url]);
  const imageSource = React.useMemo(() => ({ uri: message?.media_url }), [message?.media_url]);

  // Safety check for invalid messages - AFTER all hooks have been called
  if (!message || !message.id) {
    console.log('🟣 [TRACE] MessageItem render (invalid)', { message });
    return null
  }

  // SMALL CONVERSATION FIX: Add extra logging for debugging small conversation issues
  if (__DEV__) {
    console.log('🟣 [TRACE] MessageItem render', { 
      message: message.id, 
      index, 
      currentIndex,
      isOptimistic: !!message._isSending,
      tempId: message.tempId || message._tempId
    });
  }

  return (
    <Animated.View style={[styles.messageItem, removalAnimatedStyle]}>
      {message.media_url ? (
        <View style={styles.fullScreenMediaContainer}>
          {/* Debug: Log message data to see what media_type we have */}
          {__DEV__ && console.log(`🔍 [CHAT_MEDIA_DEBUG] Message ${message.id} - media_type: "${message.media_type}", media_url: ${message.media_url?.split('/').pop()}`)}
          
          {/* Media (image or video) */}
          {message.media_type === 'video' ? (
            <VideoPlayerWrapper
              source={videoSource}
              style={styles.fullScreenMedia}
              shouldPlay={index === currentIndex && (!isNsfwMessage || (nsfwTimerState.isActive && nsfwTimerState.messageId === message.id)) && !isRemoving && !suspendMedia}
              isLooping={!message.is_nsfw} // NSFW videos should not loop - they play once then auto-complete
              isMuted={message.is_muted !== false} // Default to muted unless explicitly set to false
              useNativeControls={false}
              autoPlay={false}
              mediaType={message.view_once ? 'one_time' : message.is_nsfw ? 'nsfw' : 'permanent'}
              onPlaybackStatusUpdate={message.is_nsfw ? onPlaybackStatusUpdate : undefined}
              onLoad={onVideoLoad}
              onError={onVideoError}
              onDurationLoad={message.is_nsfw ? onDurationLoad : undefined}
              onVideoEnd={message.is_nsfw ? onVideoEnd : undefined}
              showControls={true}
              contentFit="cover"
              priority="high"
            />
          ) : (
            <CachedImage
              source={imageSource}
              style={styles.fullScreenMedia}
              contentFit="cover"
              onLoad={() => {
                console.log('🖼️ [IMAGE_LOAD] Image loaded for message:', message.id);
                handleMediaRendered?.(message.id);
              }}
              onError={(error) => {
                console.warn('❌ [IMAGE_LOAD] Image load error for message:', message.id, error);
                // Still mark as rendered even on error to not block read receipts
                handleMediaRendered?.(message.id);
              }}
            />
          )}

          {/* One-time view blur overlay - directly above media, below all UI overlays */}
          {shouldShowBlur && (
            <View style={styles.blurOverlayContainer}>
              <OneTimeBlurOverlay 
                visible={shouldShowBlur} 
                style={styles.blurOverlay}
              />
              {/* Dark overlay for better visual effect */}
              <View style={styles.darkOverlay} />
            </View>
          )}

          {/* NSFW Tap-to-View Overlay - show when NSFW message is waiting for tap */}
          {isNsfwMessage && isCurrentMessage && nsfwTapToViewState.isWaiting && nsfwTapToViewState.messageId === message.id && (
            <NSFWTapToViewOverlay
              isVisible={true}
              onTapToView={() => handleNsfwTapToView(message.id)}
              style={styles.nsfwTapToViewOverlay}
            />
          )}

          {/* NSFW Timer Overlay - show when this is current NSFW message with active timer */}
          {isNsfwMessage && isCurrentMessage && nsfwTimerState.isActive && nsfwTimerState.messageId === message.id && (
            <NSFWTimerOverlay
              isVisible={true}
              progress={nsfwTimerState.progress}
              timeRemaining={nsfwTimerState.timeRemaining}
              mediaType={message.media_type}
              style={styles.nsfwTimerOverlay}
            />
          )}

          {/* Media type indicator overlay - icon only, no text */}
          {mediaTypeInfo && (
            <View style={[styles.mediaTypeIndicator, { backgroundColor: mediaTypeInfo.backgroundColor }]}> 
              <Ionicons 
                name={mediaTypeInfo.icon} 
                size={18} 
                color={mediaTypeInfo.color} 
              />
            </View>
          )}
        </View>
      ) : (
        <View style={styles.fullScreenTextContainer}>
          <Text style={styles.fullScreenTextMessage}>
            {message.caption || 'Message sans contenu'}
          </Text>
        </View>
      )}
      
      {/* Message caption */}
      {message.caption && (
        <View style={styles.floatingCaptionContainer}>
          <Text style={styles.caption}>{message.caption}</Text>
        </View>
      )}
      
      {/* Message info at bottom */}
      <View style={styles.floatingMessageInfo}>
        <Text style={styles.senderName}>
          {isFromCurrentUser ? 'Vous' : (otherUser?.pseudo || 'Inconnu')}
        </Text>
        <Text style={styles.messageTime}>
          {formatRelativeTime(message.created_at)}
        </Text>
        {isFromCurrentUser && (
          <>
            {message._isSending ? (
              // Show different indicators based on status
              <View style={styles.sendingIndicator}>
                <Text style={styles.sendingText}>
                  {message._sendingStatus === 'uploading' ? 'Upload...' : 
                   message._sendingStatus === 'sending' ? 'Envoi...' : 'Envoi...'}
                </Text>
              </View>
            ) : message._sendingStatus === 'failed' ? (
              // Failed indicator
              <Ionicons
                name="alert-circle"
                size={16}
                color={Colors.fire}
                style={{ marginLeft: 8 }}
              />
            ) : (
              // Normal checkmarks
              <Ionicons
                name={message.seen ? "checkmark-done" : "checkmark"}
                size={16}
                color={message.seen ? Colors.accent : Colors.white}
                style={{ marginLeft: 8 }}
              />
            )}
          </>
        )}
      </View>
    </Animated.View>
  )
})

MessageItem.displayName = 'MessageItem'

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.black,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    overflow: 'hidden',
    // Ensure full height on Android with edge-to-edge
    ...(Platform.OS === 'android' && {
      height: height,
      minHeight: height,
    }),
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.black,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: Colors.white,
    fontSize: Typography.lg,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: Colors.black,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.screen,
  },
  errorText: {
    color: Colors.white,
    fontSize: Typography.lg,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: Colors.accent,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.base,
  },
  retryText: {
    color: Colors.white,
    fontSize: Typography.base,
    fontWeight: Typography.medium,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 60 : StatusBar.currentHeight + 20,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray800,
  },
  headerButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: Colors.white,
    fontSize: Typography.xl,
    fontWeight: Typography.medium,
  },
  slidingWindowIndicator: {
    color: Colors.gray400,
    fontSize: Typography.xs,
    fontWeight: Typography.light,
    marginTop: 2,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.screen,
  },
  emptyText: {
    color: Colors.white,
    fontSize: Typography.xl,
    fontWeight: Typography.medium,
    marginBottom: Spacing.sm,
  },
  emptySubtext: {
    color: Colors.gray400,
    fontSize: Typography.base,
    marginBottom: Spacing.xl,
    textAlign: 'center',
  },
  cameraButton: {
    backgroundColor: Colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
  },
  cameraButtonText: {
    color: Colors.white,
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    marginLeft: Spacing.sm,
  },
  messagesContainer: {
    flex: 1,
  },
  fullScreenMessagesContainer: {
    flex: 1,
    position: 'relative',
  },
  carousel: {
    flexDirection: 'row',
    height: '100%',
  },
  messageItem: {
    width: width,
    height: height, // Use the full screen height calculated above
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  // Full screen media styles
  fullScreenMediaContainer: {
    width: width,
    height: height, // Use the full screen height calculated above
    position: 'absolute',
    top: 0,
    left: 0,
  },
  fullScreenMedia: {
    width: '100%',
    height: '100%',
  },
  blurOverlay: {
    borderRadius: 0, // Full screen overlay, no border radius
  },
  blurOverlayContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1, // Above media, below all UI overlays
  },
  darkOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)', // Semi-transparent dark overlay
    zIndex: 2, // Above blur, below UI overlays
  },
  mediaTypeIndicator: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 120 : StatusBar.currentHeight + 80,
    left: Spacing.lg,
    width: 28,
    height: 28,
    borderRadius: 14, // Perfect circle
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10, // Above blur overlay
  },
  nsfwTimerOverlay: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 100 : StatusBar.currentHeight + 60, // Moved down slightly
    left: 0,
    right: 0,
    zIndex: 100, // Above everything
  },
  nsfwTapToViewOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 200, // Above everything including timer overlay
  },
  fullScreenTextContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  fullScreenTextMessage: {
    color: Colors.white,
    fontSize: Typography.xxl,
    lineHeight: Typography.xxl * 1.4,
    textAlign: 'center',
    fontWeight: Typography.medium,
  },
  // Floating controls
  floatingControls: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : StatusBar.currentHeight + 20,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    zIndex: 20, // Above everything including blur overlay
  },
  rightButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  floatingBackButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.blackOverlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  floatingCameraButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.blackOverlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  floatingFlagButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.blackOverlay,
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.8,
  },
  floatingUserInfo: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  floatingUserName: {
    color: Colors.white,
    fontSize: Typography.lg,
    fontWeight: Typography.semiBold,
    textShadowColor: Colors.blackOverlay,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  floatingCaptionContainer: {
    position: 'absolute',
    bottom: 120,
    left: Spacing.lg,
    right: Spacing.lg,
    backgroundColor: Colors.blackOverlay,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    zIndex: 15, // Above blur overlay
  },
  floatingMessageInfo: {
    position: 'absolute',
    bottom: 40,
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.blackOverlay,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    zIndex: 25, // Above blur overlay and all other UI elements
  },
  senderName: {
    color: Colors.white,
    fontSize: Typography.base,
    fontWeight: Typography.semiBold,
    marginRight: Spacing.sm,
  },
  floatingHintContainer: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 140 : 120, // Moved up to not block bottom section
    left: Spacing.lg,
    right: Spacing.lg,
    backgroundColor: Colors.blackOverlay,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    alignItems: 'center',
    zIndex: 20, // Above everything including blur overlay
  },
  caption: {
    color: Colors.white,
    fontSize: Typography.base,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  // Swipe-up camera overlay styles
  cameraSwipeOverlay: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 30,
  },
  cameraSwipePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.blackOverlay,
    borderRadius: 24,
  },
  cameraSwipeText: {
    color: Colors.white,
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    marginLeft: Spacing.sm,
  },
  messageTime: {
    color: Colors.white,
    fontSize: Typography.sm,
    flex: 1,
    marginLeft: Spacing.sm,
  },
  sendingIndicator: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 10,
  },
  sendingText: {
    color: Colors.white,
    fontSize: Typography.xs,
    fontStyle: 'italic',
  },
  progressText: {
    color: Colors.white,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  hintText: {
    color: Colors.white,
    fontSize: Typography.sm,
    flex: 1,
  },
  notificationLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000, // Above everything
  },
  notificationLoadingText: {
    color: Colors.white,
    fontSize: Typography.base,
    marginTop: Spacing.md,
    textAlign: 'center',
  },
})

export default ChatScreen
