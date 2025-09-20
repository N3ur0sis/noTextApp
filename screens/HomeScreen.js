import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { Image } from 'expo-image'
import CachedImage from '../components/CachedImage'
import { router, useLocalSearchParams } from 'expo-router'
import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react'
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native'
import AppStatusBar from '../components/AppStatusBar'
import ThumbnailBlurOverlay from '../components/ThumbnailBlurOverlay'
import { BorderRadius, Colors, Spacing, Typography } from '../constants/Design'
import { useAuthContext } from '../context/AuthContext'
import { useSimpleConversations } from '../hooks/useSimpleConversations'
import { apiManager } from '../services/apiManager'
import { oneTimeViewService } from '../services/oneTimeViewService'
import { nsfwViewService } from '../services/nsfwViewService'
import { formatRelativeTime } from '../utils/timeUtils'
import { realtimeCacheManager } from '../services/realtimeCacheManager'
import { findUserByUserId } from '../services/userService'
import { getMediaPreviewSource, getMediaTypeInfo, shouldShowMediaPlaceholder } from '../utils/mediaTypeUtils'
import { getSafeAreaTop } from '../utils/responsive'
import { useConversationMediaPreloader } from '../utils/mediaPreloaders' // P5 FIX: Import conversation media preloader
import { blockService } from '../services/blockService'
import { unreadCountService } from '../services/unreadCountService'
import { chatStore } from '../data/stores/chatStore'
import { messagesCache } from '../data/messagesCache'
import { chatVisibilityService } from '../services/chatVisibilityService'
import ConversationContextMenu from '../components/ConversationContextMenu'
import ReportUserModal from '../components/ReportUserModal'
import ReportEmailService from '../services/reportEmailService'
import ReportAPIService from '../services/reportAPIService'
import ConversationService from '../services/conversationService'

// Performance logging - only in development
const debugLog = __DEV__ ? (operation, data = null) => {
  const timestamp = new Date().toISOString()
  console.log(`🔍 [HOME] ${timestamp} - ${operation}${data ? ':' : ''}`, data || '')
} : () => {} // No-op in production

const logSummary = __DEV__ ? (operation, metrics) => {
  const timestamp = new Date().toISOString()
  console.log(`📊 [PERFORMANCE] ${timestamp} - ${operation}:`, metrics)
} : () => {} // No-op in production

const HomeScreen = () => {
  console.log('🟢 [TRACE] HomeScreen render');
  // Get user from AuthContext
  const { user: currentUser, loading: authLoading } = useAuthContext()
  console.log('🟢 [TRACE] useAuthContext', { currentUser, authLoading });
  
  // Use optimized conversations hook with new API manager
  const {
    conversations,
    loading: conversationsLoading,
    error: conversationsError,
    refresh: hookRefresh,
    lastUpdate
  } = useSimpleConversations(currentUser?.id)
  console.log('🟢 [TRACE] useSimpleConversations', { userId: currentUser?.id, conversationsCount: conversations.length });
  
  // Minimal state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [refreshing, setRefreshing] = useState(false)
  const [unreadCounts, setUnreadCounts] = useState({}) // Track unread count per conversation
  console.log('🟢 [TRACE] useState', { searchQuery, searchResults, refreshing });

  // Modal states for reporting and conversation actions
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [contextMenuPosition, setContextMenuPosition] = useState(null)
  const [showReportModal, setShowReportModal] = useState(false)
  const [selectedConversationUser, setSelectedConversationUser] = useState(null)

  // Block service state
  const [blockedUsers, setBlockedUsers] = useState([])

  // Control refs - simplified since hook handles most logic
  const lastFocusTimeRef = useRef(0)
  const mountTimeRef = useRef(Date.now())
  const instanceIdRef = useRef(Math.random().toString(36).substr(2, 9))
  const searchTimeoutRef = useRef(null)
  const hookRefreshRef = useRef(hookRefresh) // Store the refresh function in a ref
  const lastNotificationNavigationRef = useRef(0) // Prevent duplicate notification navigation
  const calculateUnreadCountsRef = useRef(null) // Store the unread count calculation function
  
  // Update ref when hookRefresh changes
  hookRefreshRef.current = hookRefresh

  debugLog('RENDER', { 
    renderTime: Date.now() - mountTimeRef.current,
    hasUser: !!currentUser,
    authLoading: authLoading,
    conversationCount: conversations.length,
    instanceId: instanceIdRef.current,
    isLoading: conversationsLoading,
    userFromContext: !!currentUser
  })

  // Filter conversations to exclude blocked users
  const filteredConversations = useMemo(() => {
    if (!conversations || conversations.length === 0) return conversations
    
    // Only filter if blockService is initialized and we have blocked users
    if (blockedUsers.length === 0) return conversations
    
    return conversations.filter(conversation => {
      const otherUserId = conversation.receiver_id === currentUser?.id 
        ? conversation.sender_id 
        : conversation.receiver_id
      
      const isBlocked = blockedUsers.includes(String(otherUserId))
      if (isBlocked) {
        console.log('📵 [BLOCK] Filtering blocked conversation:', { 
          otherUserId, 
          pseudo: conversation.otherUser?.pseudo,
          blockedUsersCount: blockedUsers.length 
        })
      }
      return !isBlocked
    })
  }, [conversations, blockedUsers, currentUser?.id])

  // P5 FIX: Preload conversation media for faster display
  useConversationMediaPreloader(conversations)

  // Remove old cache warming - handled by hook
  // Remove old refreshConversations function - handled by hook

  // Hook handles initialization now - no need for complex initializeApp function

  // Parse params for navigation
  const params = useLocalSearchParams()
  const hasNewMessages = params?.hasNewMessages === 'true'
  const unreadCount = params?.unreadCount ? parseInt(params.unreadCount, 10) : 0
  const messageTimestamp = params?.timestamp ? parseInt(params.timestamp, 10) : 0
  const fromChat = params?.fromChat === 'true'

  // Initialize block service and listen for changes
  useEffect(() => {
    const initializeBlockService = async () => {
      console.log('🔧 [HOME] Initializing block service...')
      await blockService.initialize()
      const blocked = await blockService.getBlockedUsers()
      console.log('🔧 [HOME] Block service initialized, blocked users:', blocked)
      console.log('🔧 [HOME] Setting blockedUsers state to:', blocked)
      setBlockedUsers(blocked)
      
      // Double-check what we stored
      const count = await blockService.getBlockedUsersCount()
      console.log('🔧 [HOME] Block service count verification:', count)
    }

    initializeBlockService()

    // Listen for block list changes
    const unsubscribe = blockService.addListener((updatedBlockedUsers) => {
      console.log('🔧 [HOME] Block list updated via listener:', updatedBlockedUsers)
      setBlockedUsers(updatedBlockedUsers)
    })

    return unsubscribe
  }, [])

  // 🔥 REALTIME: Smart focus-based refresh - Only refresh when needed
  useFocusEffect(
    useCallback(() => {
      console.log('🟢 [TRACE] useFocusEffect (conversations refresh)');
      
      // Track home screen visibility for notification suppression
      try {
        console.log(`👁️ [HOME] Home screen focused`)
        console.log(`👁️ [HOME] chatVisibilityService available:`, !!chatVisibilityService)
        console.log(`👁️ [HOME] setHomeScreenVisible method:`, typeof chatVisibilityService?.setHomeScreenVisible)
        chatVisibilityService.setHomeScreenVisible()
        console.log(`👁️ [HOME] setHomeScreenVisible called successfully`)
      } catch (error) {
        console.error(`❌ [HOME] Error setting home screen visible:`, error)
      }
      
      if (!currentUser) return
      
      const now = Date.now()
      const timeSinceLastFocus = now - lastFocusTimeRef.current
      
      // Only refresh if it's been more than 30 seconds since last focus
      // This prevents excessive API calls when quickly switching tabs or returning from notifications
      const shouldRefresh = timeSinceLastFocus > 30000 || lastFocusTimeRef.current === 0
      
      debugLog('FOCUS_EFFECT', {
        hasUser: !!currentUser,
        conversationCount: conversations.length,
        instanceId: instanceIdRef.current,
        timeSinceLastFocus,
        shouldRefresh
      })
      
      lastFocusTimeRef.current = now
      
      // Only refresh if enough time has passed or this is the first focus
      if (shouldRefresh) {
        const refreshFn = hookRefreshRef.current
        if (refreshFn) {
          console.log('🔄 [HOME] Smart refresh triggered (time since last focus: ' + timeSinceLastFocus + 'ms)')
          // Use cache-respecting refresh for focus-based refreshes to avoid unnecessary API calls
          refreshFn({ forceRefresh: false, silent: true })
        }
      } else {
        console.log('⏭️ [HOME] Skipping refresh - too recent (time since last focus: ' + timeSinceLastFocus + 'ms)')
      }
      
      // Also register for direct refresh when receiving new messages
      const handleRealTimeEvent = (eventData) => {
        console.log('🟢 [TRACE] handleRealTimeEvent', eventData);
        if (currentUser) {
          debugLog('REALTIME_EVENT_TRIGGERED_REFRESH', { eventData })
          const refreshFn = hookRefreshRef.current
          if (refreshFn) {
            // Real-time events should respect cache but be silent to avoid loading indicators
            refreshFn({ forceRefresh: false, silent: true })
          }
          
          // Also trigger unread count recalculation since new messages might have arrived
          if (conversations?.length > 0) {
            console.log('🔢 [HOME] Realtime event triggered, recalculating unread counts')
            calculateUnreadCountsRef.current?.()
              .catch(error => console.error('❌ [HOME] Error recalculating unread counts from realtime:', error))
          }
        }
      }
      
      // Specific handler for conversationUpdate to track it separately
      const handleConversationUpdate = (eventData) => {
        console.log('🟢 [TRACE] handleConversationUpdate', eventData);
        if (currentUser) {
          debugLog('🔥 CONVERSATION_UPDATE_EVENT_RECEIVED', { eventData })
          const refreshFn = hookRefreshRef.current
          if (refreshFn) {
            // Conversation updates should respect cache but be silent
            refreshFn({ forceRefresh: false, silent: true })
          }
        }
      }
      
      // Listen for realtime events that should trigger immediate UI refresh
      realtimeCacheManager.on('messageReceived', handleRealTimeEvent)
      realtimeCacheManager.on('messageSent', handleRealTimeEvent)
      realtimeCacheManager.on('conversationUpdate', handleConversationUpdate)  // Use specific handler
      realtimeCacheManager.on('messageReadStatusUpdated', handleRealTimeEvent) // Handle NSFW read events
      
      // Listen for app returning from background (force refresh)
      const handleAppReturnFromBackground = (data) => {
        console.log('🔄 [HOME] App returned from background, forcing refresh:', data)
        const refreshFn = hookRefreshRef.current
        if (refreshFn) {
          console.log('🔄 [HOME] Force refreshing conversations after background return')
          refreshFn({ forceRefresh: true, silent: false })
        }
      }
      realtimeCacheManager.on('appReturnedFromBackground', handleAppReturnFromBackground)
      
      // Listen for simplified app open from notifications
      realtimeCacheManager.on('appOpenedFromNotification', (data) => {
        console.log('📱 [HOME] App opened from notification - refreshing data:', data)
        const { senderId, senderPseudo, hasNewMessage, forceRefresh, fallback } = data
        
        // Force refresh conversations to show latest data
        if (forceRefresh) {
          console.log('📱 [HOME] Force refreshing conversations after notification')
          const refreshFn = hookRefreshRef.current
          if (refreshFn) {
            refreshFn({ forceRefresh: true, silent: false })
          }
        }
        
        // Log notification context for user awareness
        if (hasNewMessage && senderId && senderPseudo) {
          console.log(`📱 [HOME] New message notification from ${senderPseudo} - user can tap conversation to view`)
        }
        
        // Update badge count and ensure proper app state
        const { notificationIntegration } = require('../services/notificationIntegration')
        if (notificationIntegration?.updateBadgeCount) {
          notificationIntegration.updateBadgeCount()
        }
      })

      // COLD START FIX: Mark HomeScreen as ready for notification events
      realtimeCacheManager.setHomeScreenReady()
      
      return () => {
        try {
          console.log(`👁️ [HOME] Home screen unfocused`)
          console.log(`👁️ [HOME] setHomeScreenHidden method:`, typeof chatVisibilityService?.setHomeScreenHidden)
          chatVisibilityService.setHomeScreenHidden()
          console.log(`👁️ [HOME] setHomeScreenHidden called successfully`)
        } catch (error) {
          console.error(`❌ [HOME] Error setting home screen hidden:`, error)
        }
        
        // COLD START FIX: Mark HomeScreen as not ready
        realtimeCacheManager.setHomeScreenNotReady()
        
        // Remove event listeners when component loses focus
        realtimeCacheManager.off('messageReceived', handleRealTimeEvent)
        realtimeCacheManager.off('messageSent', handleRealTimeEvent)
        realtimeCacheManager.off('conversationUpdate', handleConversationUpdate) // Remove specific handler
        realtimeCacheManager.off('messageReadStatusUpdated', handleRealTimeEvent) // Remove NSFW read handler
        realtimeCacheManager.off('appReturnedFromBackground', handleAppReturnFromBackground) // Remove background return handler
        realtimeCacheManager.off('appOpenedFromNotification') // Remove simplified notification handler
      }
      
    }, [currentUser?.id]) // FIXED: Only depend on user ID, not hookRefresh which changes on every render
  )

  // Sync services when conversations change
  useFocusEffect(
    useCallback(() => {
      console.log('🟢 [TRACE] useFocusEffect (NSFW/oneTime sync)');
      if (conversations && conversations.length > 0 && currentUser) {
        // Initialize NSFW service
        nsfwViewService.init()
        
        // Convert conversations to message format for syncing one-time messages
        const messagesFromConversations = conversations.map(conv => ({
          id: conv.last_message_id || conv.id,
          view_once: conv.view_once,
          receiver_id: conv.receiver_id,
          viewed_at: conv.viewed_at
        })).filter(msg => msg.view_once) // Only one-time messages
        
        oneTimeViewService.loadAndSyncMessages(messagesFromConversations, currentUser.id)
          .catch(error => console.error('❌ [HOME] Failed to sync one-time messages:', error))
        
        // Calculate unread counts for each conversation
        const calculateUnreadCounts = async () => {
          try {
            await unreadCountService.init()
            const newUnreadCounts = {}
            
            for (const conversation of conversations) {
              const otherUserId = conversation.receiver_id === currentUser.id 
                ? conversation.sender_id 
                : conversation.receiver_id || conversation.otherUser?.id
              
              if (otherUserId) {
                // Clean up any stale read status when conversation flow changes
                await unreadCountService.cleanupViewedMessages(currentUser.id, otherUserId)
                
                const count = await unreadCountService.getUnreadCountForConversation(currentUser.id, otherUserId)
                newUnreadCounts[otherUserId] = count
              }
            }
            
            setUnreadCounts(newUnreadCounts)
            console.log('🔢 [HOME] Updated unread counts:', newUnreadCounts)
          } catch (error) {
            console.error('❌ [HOME] Failed to calculate unread counts:', error)
          }
        }
        
        // Store in ref so it can be called from realtime event handlers
        calculateUnreadCountsRef.current = calculateUnreadCounts
        
        calculateUnreadCounts()
      }
    }, [conversations, currentUser])
  )

  // Refresh when returning to home screen (e.g., from chat)
  useFocusEffect(
    useCallback(() => {
      console.log('🟢 [TRACE] useFocusEffect (refresh on focus)');
      
      // Only refresh if we have a user and this isn't the initial mount
      if (currentUser?.id && Date.now() - mountTimeRef.current > 1000) {
        console.log('🔄 [HOME] Screen regained focus, refreshing conversations and unread counts')
        
        // Refresh conversations to get latest read status
        const refreshFn = hookRefreshRef.current
        if (refreshFn) {
          refreshFn({ forceRefresh: false }) // Soft refresh to update read status
            .catch(error => console.error('❌ [HOME] Error refreshing on focus:', error))
        }
        
        // Recalculate unread counts
        if (calculateUnreadCountsRef.current) {
          calculateUnreadCountsRef.current()
            .catch(error => console.error('❌ [HOME] Error recalculating unread counts:', error))
        }
      }
    }, [currentUser?.id])
  )

  // Refresh conversations function - can be called from anywhere
  // Old refreshConversations function removed - hook handles all data management now
  
  // REFRESH HANDLER - Force fresh data from database - FIXED: Stable dependencies
  const handleRefresh = useCallback(async () => {
    console.log('🟢 [TRACE] handleRefresh called');
    if (refreshing) return
    
    debugLog('MANUAL_REFRESH_START', { trigger: 'pull_to_refresh' })
    setRefreshing(true)
    
    try {
      const refreshFn = hookRefreshRef.current
      if (refreshFn) {
        console.log('🔄 [HOME] Manual refresh - forcing fresh data')
        await refreshFn({ forceRefresh: true }) // Manual refresh should force fresh data
      }
      debugLog('MANUAL_REFRESH_SUCCESS', { 
        conversationCount: conversations.length
      })
    } catch (error) {
      console.error('❌ [MANUAL REFRESH] Error:', error)
      debugLog('MANUAL_REFRESH_ERROR', { error: error.message })
    } finally {
      setRefreshing(false)
      debugLog('MANUAL_REFRESH_COMPLETE')
    }
  }, [refreshing]) // FIXED: Remove hookRefresh dependency, use ref instead
  const handleSearchInput = useCallback(async (text) => {
    console.log('🟢 [TRACE] handleSearchInput', text);
    const trimmedText = text.trim()
    setSearchQuery(text)
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    if (trimmedText.length < 2) {
      setSearchResults([])
      return
    }

    debugLog('SEARCH_INPUT', { query: trimmedText })

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        debugLog('SEARCH_API_CALL', { query: trimmedText })
        
        // Use unified apiManager for user search
        const results = await apiManager.searchUsers(trimmedText)
        const filtered = results.filter(user => user.id !== currentUser?.id)
        
        // Filter out blocked users completely from search results
        const unblocked = filtered.filter(user => !blockedUsers.includes(String(user.id)))
        
        console.log('🔍 [SEARCH] Search filtering:', { 
          total: results.length,
          afterSelfFilter: filtered.length,
          afterBlockFilter: unblocked.length,
          blockedUsersCount: blockedUsers.length, 
          blockedUsers: blockedUsers,
          blockedUsersState: blockedUsers,
          searchResults: unblocked.map(u => ({ id: u.id, pseudo: u.pseudo }))
        })
        
        setSearchResults(unblocked)
        
        debugLog('SEARCH_API_RESPONSE', { 
          total: results.length, 
          filtered: filtered.length
        })

      } catch (error) {
        debugLog('SEARCH_ERROR', { error: error.message })
        setSearchResults([])
      }
    }, 300)
  }, [currentUser, blockedUsers]) // Added blockedUsers to dependencies

  // Direct search (search button)
  const handleDirectSearch = useCallback(async () => {
    console.log('🟢 [TRACE] handleDirectSearch', searchQuery);
    if (!searchQuery.trim()) return

    debugLog('DIRECT_SEARCH', { query: searchQuery.trim() })

    try {
      // Use unified apiManager for direct user search
      const user = await apiManager.findUserByPseudo(searchQuery.trim())
      
      if (user) {
        if (user.id === currentUser?.id) {
          Alert.alert('Erreur', 'Vous ne pouvez pas vous envoyer un message à vous-même')
          return
        }
        
        debugLog('NAVIGATE_NEW_CHAT', { targetUserId: user.id, pseudo: user.pseudo })
        router.push({
          pathname: '/chat',
          params: { 
            otherUser: JSON.stringify(user),
            isNewConversation: true 
          }
        })
      } else {
        Alert.alert('Utilisateur introuvable', 'Aucun utilisateur trouvé avec ce pseudo')
      }
    } catch (error) {
      debugLog('DIRECT_SEARCH_ERROR', { error: error.message })
      Alert.alert('Erreur', 'Impossible de rechercher cet utilisateur')
    } finally {
      setSearchQuery('')
      setSearchResults([])
    }
  }, [searchQuery, currentUser])

  // Select user from search results
  const selectUser = useCallback((user) => {
    console.log('🟢 [TRACE] selectUser', user);
    debugLog('SELECT_USER', { userId: user.id, pseudo: user.pseudo })
    
    router.push({
      pathname: '/chat',
      params: { 
        otherUser: JSON.stringify(user),
        isNewConversation: true 
      }
    })
    
    setSearchQuery('')
    setSearchResults([])
  }, [])

  // Navigate to conversation
  // Optimized: Only fetch new messages and signed URLs for uncached media
  const navigateToConversation = useCallback(async (conversation) => {
    console.log('🟢 [TRACE] navigateToConversation', conversation);
    // Use peer_id which is the other user's ID in the conversation
    const otherUserId = conversation.peer_id || conversation.otherUser?.id

    debugLog('NAVIGATE_CONVERSATION', { 
      conversationId: conversation.id,
      otherUserId,
      otherUserPseudo: conversation.otherUser?.pseudo
    })

    // Ensure we have valid otherUser data before navigation
    let otherUser = conversation.otherUser
    
    // If we don't have proper user data, try to fetch it
    if (!otherUser || !otherUser.pseudo || otherUser.pseudo.startsWith('User #')) {
      console.log('🔍 [NAVIGATION] Missing or placeholder pseudo, fetching user info for:', otherUserId)
      try {
        const userInfo = await findUserByUserId(otherUserId)
        if (userInfo && userInfo.pseudo) {
          otherUser = {
            id: userInfo.id,
            pseudo: userInfo.pseudo
          }
          console.log('✅ [NAVIGATION] Found user info:', userInfo.pseudo)
          
          // Update the unified conversation cache with the real user info
          const conversations = realtimeCacheManager.getAllConversationCaches(currentUser.id) || []
          const updatedConversations = conversations.map(conv => 
            conv.id === conversation.id ? { ...conv, otherUser } : conv
          )
          realtimeCacheManager.updateAllConversationCaches(currentUser.id, updatedConversations, true)
        }
      } catch (error) {
        console.error('❌ [NAVIGATION] Error fetching user info:', error)
        // Keep the existing otherUser data even if it's a placeholder
      }
    }

    // 1. Pre-warm the sliding window messages cache for instant loading
    // Only pre-warm the last 5 messages for optimal performance
    try {
      console.log('🔍 [NAVIGATION] Pre-warming sliding window cache for instant chat loading')
      const messages = await apiManager.getMessages(currentUser.id, otherUserId, { 
        limit: 5, // Only get 5 messages for sliding window
        orderBy: 'created_at',
        orderDirection: 'desc'
      })
      
      if (messages && messages.length > 0) {
        console.log('✅ [NAVIGATION] Sliding window cache pre-warmed with', messages.length, 'messages')
        
        // Pre-load only the most recent message media for instant display
        const latestMessage = messages[messages.length - 1]
        if (latestMessage?.media_url && !latestMessage.media_url.includes('file://')) {
          // ❌ Pas de preload d'originaux ici. Éventuellement preload une THUMB légère si tu en as.
        }
      }
    } catch (error) {
      console.error('❌ [NAVIGATION] Error pre-warming sliding window cache:', error)
      // Continue navigation even if pre-warming fails
    }

    // 2. Mark unread messages as read when opening conversation - REMOVED
    // Let ChatScreen handle read receipts only when user actually views each message
    console.log('📖 [HOME SCREEN] Conversation opened - ChatScreen will handle read receipts when user views messages')

    // 3. Navigate to chat, passing otherUser and otherUserId
    // Ensure otherUser object includes the id field for proper parameter parsing
    const otherUserWithId = {
      ...otherUser,
      id: otherUserId // Explicitly include the id
    }
    
    if (__DEV__) console.log('🚀 [HOME] Navigating to /chat with params', { otherUserId: String(otherUserId) })
    router.push({
      pathname: '/chat',
      params: { 
        otherUser: JSON.stringify(otherUserWithId),
        otherUserId: String(otherUserId) // Ensure it's explicitly a string
      }
    })
  }, [currentUser])

  // Handle long press on conversation item with fixed position
  const handleConversationLongPress = useCallback((item, event) => {
    const otherUser = item.otherUser || {
      id: item.receiver_id === currentUser?.id ? item.sender_id : item.receiver_id,
      pseudo: item.otherUser?.pseudo || 'Utilisateur'
    }
    
    // Get the touch target position for more consistent placement
    const { target } = event
    target.measure((x, y, width, height, pageX, pageY) => {
      setSelectedConversationUser(otherUser)
      setContextMenuPosition({
        x: pageX + width / 2, // Center horizontally on the conversation item
        y: pageY + height + 10 // Position just below the conversation item
      })
      setShowContextMenu(true)
    })
  }, [currentUser])

  // Handle report user action
  const handleReportUser = useCallback(() => {
    setShowContextMenu(false)
    setShowReportModal(true)
  }, [])

  // Handle block user action
  const handleBlockUser = useCallback(async () => {
    setShowContextMenu(false)
    
    if (!selectedConversationUser) {
      console.error('❌ [BLOCK] No user selected for blocking')
      return
    }

    Alert.alert(
      'Bloquer l\'utilisateur',
      `Voulez-vous bloquer ${selectedConversationUser.pseudo || 'cet utilisateur'} ?\n\nVous ne recevrez plus de messages ni de notifications de cette personne.`,
      [
        {
          text: 'Annuler',
          style: 'cancel'
        },
        {
          text: 'Bloquer',
          style: 'destructive',
          onPress: async () => {
            try {
              console.log('🚫 [HOME] Attempting to block user:', selectedConversationUser)
              const success = await blockService.blockUser(
                String(selectedConversationUser.id), 
                selectedConversationUser // Pass the full user object
              )
              
              console.log('🚫 [HOME] Block result:', success)
              
              if (success) {
                // Show success message
                Alert.alert(
                  'Utilisateur bloqué',
                  `${selectedConversationUser.pseudo} a été bloqué avec succès.`,
                  [{ text: 'OK' }]
                )
                
                // Refresh conversations to hide blocked user
                if (hookRefreshRef.current) {
                  hookRefreshRef.current()
                }
              } else {
                Alert.alert('Erreur', 'L\'utilisateur était déjà bloqué.')
              }
            } catch (error) {
              console.error('❌ [BLOCK] Error blocking user:', error)
              Alert.alert('Erreur', 'Impossible de bloquer l\'utilisateur.')
            }
          }
        }
      ]
    )
  }, [selectedConversationUser])

  // Handle conversation deletion
  const handleDeleteConversation = useCallback(() => {
    if (!selectedConversationUser) return

    Alert.alert(
      'Supprimer la conversation',
      `Voulez-vous vraiment supprimer toute la conversation avec ${selectedConversationUser.pseudo || 'cet utilisateur'} ?\n\nTous les messages seront définitivement supprimés et cette action ne peut pas être annulée.`,
      [
        {
          text: 'Annuler',
          style: 'cancel'
        },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              console.log('🗑️ [HOME] Attempting to delete conversation with user:', selectedConversationUser)
              
              const result = await ConversationService.deleteConversation(
                String(selectedConversationUser.id), 
                selectedConversationUser.pseudo
              )
              
              console.log('🗑️ [HOME] Delete result:', result)
              
              if (result.success) {
                // Show success message
                Alert.alert(
                  'Conversation supprimée',
                  result.message,
                  [{ text: 'OK' }]
                )
                
                // Refresh conversations to remove deleted conversation
                if (hookRefreshRef.current) {
                  hookRefreshRef.current()
                }
              } else {
                Alert.alert('Erreur', 'Impossible de supprimer la conversation.')
              }
            } catch (error) {
              console.error('❌ [DELETE] Error deleting conversation:', error)
              Alert.alert('Erreur', `Impossible de supprimer la conversation: ${error.message}`)
            }
          }
        }
      ]
    )
  }, [selectedConversationUser])

  // Handle report submission
  const handleReportSubmit = useCallback(async (reportData) => {
    try {
      // Enrich report data with current user information
      const enrichedReportData = {
        ...reportData,
        reporter: {
          id: currentUser?.id,
          pseudo: currentUser?.pseudo || reportData.reporterPseudo
        }
      }
      
      await ReportEmailService.sendReport(enrichedReportData)
      console.log('✅ [HOME] Report submitted successfully')
    } catch (error) {
      console.error('❌ [HOME] Failed to submit report:', error)
      throw error
    }
  }, [currentUser])

  // Optimized conversation item with minimal re-render logic
  const ConversationItem = React.memo(({ item }) => {
    console.log('🟢 [TRACE] ConversationItem render', item);
  // FIXED: Use the correct indicators from cache with improved logic
  const isNewMessage = item.has_new_message || false  // "I have unread incoming messages"

    // Get unread count for this conversation
    const otherUserId = item.receiver_id === currentUser?.id ? item.sender_id : item.receiver_id || item.otherUser?.id
    const unreadCount = unreadCounts[otherUserId] || 0
    const showUnreadBadge = unreadCount > 0

    // Derive read/delivered state from the last message payload (prefer messages cache)
    let last = item.last_message || {}
    try {
      const otherUserId = item.receiver_id === currentUser?.id ? item.sender_id : item.receiver_id || item.otherUser?.id
      if (currentUser?.id && otherUserId) {
        const cacheKey = `messages_currentUserId:${currentUser.id}|otherUserId:${otherUserId}`
        const msgs = apiManager.getFromCache(cacheKey)
        if (Array.isArray(msgs) && msgs.length > 0) {
          // Use the most recent message from the cached messages, but validate it matches
          const cachedLast = msgs[msgs.length - 1]
          // Only use cached message if it matches the conversation's last_message_id
          if (cachedLast && cachedLast.id === item.last_message_id) {
            last = cachedLast
          }
          // Otherwise stick with item.last_message to avoid inconsistencies
        }
      }
    } catch (e) {
      // Ignore cache read issues and fall back to item.last_message
    }

    const lastSenderId = last?.sender_id || (last?.sender && last.sender.id) || null
    const lastSeen = item.last_seen === true || Boolean(item.last_seen_at)

  // Message is considered outgoing when last_message.sender_id matches current user
  const isOutgoing = lastSenderId === currentUser?.id

  // Determine read state for checkmarks - ONLY for outgoing messages
  // Fix: Only show checkmarks if the last message is actually from current user
  const lastSeenByOther = isOutgoing && (
    Boolean(last?.seen) ||
    Boolean(last?.seen_at) ||
    item.seen_by_other === true
  )

  // Keep seen_by_me for other UI hints (blur, etc.)
  const convSeenByMe = item.seen_by_me ?? (!isOutgoing ? item.last_seen ?? lastSeen : false)

  // FIXED: Only show checkmarks when the last message is ours AND we don't have newer incoming messages
  // This prevents showing checkmarks for received messages
  const shouldShowCheckmarks = isOutgoing && !isNewMessage && lastSenderId === currentUser?.id

  // Show double-check (read) when the other user has explicitly read our last message
  const isReadIndicator = shouldShowCheckmarks && lastSeenByOther
  // Single check when our message not yet read but it's still the latest
  const showSingleCheck = shouldShowCheckmarks && !lastSeenByOther

  // DEBUG: Log checkmark logic for troubleshooting
  if (__DEV__ && (isReadIndicator || showSingleCheck || lastSenderId !== currentUser?.id)) {
    console.log(`🔍 [CHECKMARK_DEBUG] ${item.id}:`, {
      lastSenderId,
      currentUserId: currentUser?.id,
      lastMessageId: last?.id,
      itemLastMessageId: item.last_message_id,
      lastMessageFromCache: !!last?.id && last.id !== item.last_message?.id,
      isOutgoing,
      isNewMessage,
      shouldShowCheckmarks,
      isReadIndicator,
      showSingleCheck,
      lastSeenByOther,
      actualLastMessageSender: item.last_message?.sender_id
    })
  }
    
    // Check if this is a one-time message that should be blurred
    const isOneTimeMessage = Boolean(item.view_once)
    const isCurrentUserReceiver = item.receiver_id === currentUser?.id
    
    // For one-time messages: blur for receiver AFTER viewed (like chat screen)
    const messageId = item.last_message_id || item.id
    const shouldBlurOneTime = isOneTimeMessage && 
                             isCurrentUserReceiver &&
                             (item.seen === true || 
                               Boolean(item.viewed_at && item.viewed_at !== null) ||
                               oneTimeViewService.isViewed(messageId))
    
    const isNsfwMessage = item.is_nsfw
    
    // For NSFW messages: blur for receiver BEFORE viewed (to hide content)
    const shouldBlurNsfw = isNsfwMessage && 
                          isCurrentUserReceiver &&
                          !(item.seen === true || 
                            Boolean(item.viewed_at && item.viewed_at !== null) ||
                            nsfwViewService.isViewed(messageId))
    
    // Overall blur decision - blur if either condition is true
    const shouldBlurMessage = shouldBlurOneTime || shouldBlurNsfw
    
    const isVideoMessage = item.latestMediaType === 'video'

    // Use unified media utilities
    const mediaTypeInfo = getMediaTypeInfo(item)
    const showPlaceholder = shouldShowMediaPlaceholder(item)
    const imageSource = getMediaPreviewSource(item)

    // Debug thumbnail URLs
    if (__DEV__ && isVideoMessage) {
      console.log(`🎯 [HOME_THUMBNAIL] Video message debug:`, {
        conversationId: item.id,
        latestMediaUrl: item.latestMediaUrl?.split('/').pop(),
        latestThumbnailUrl: item.latestThumbnailUrl?.split('/').pop(),
        lastMessage_thumbnailUrl: item.last_message?.thumbnail_url?.split('/').pop(),
        imageSource: imageSource?.split('/').pop(),
        showPlaceholder
      })
    }

    return (
      <TouchableOpacity
        style={[styles.conversationItem, isNewMessage && styles.conversationItemNew]}
        onPress={() => navigateToConversation(item)}
        onLongPress={(event) => handleConversationLongPress(item, event)}
      >
        <View style={styles.conversationContent}>
          <View style={styles.mediaPreview}>
            {showPlaceholder ? (
              <View style={[styles.previewImage, styles.placeholderContainer]}>
                <Ionicons 
                  name={
                    item.view_once ? 'eye' : 
                    isVideoMessage ? 'videocam' : 'image-outline'
                  } 
                  size={24} 
                  color={
                    item.view_once ? Colors.accent : 
                    Colors.gray
                  } 
                />
              </View>
            ) : (
              <View style={styles.imageContainer}>
                <CachedImage
                  source={{ uri: imageSource }}
                  style={styles.previewImage}
                  contentFit="cover"
                  onLoad={() => {
                    if (__DEV__) {
                      console.log(`✅ [HOME_THUMBNAIL] Successfully loaded image: ${imageSource?.split('/').pop()}`)
                    }
                  }}
                  onError={(error) => {
                    if (__DEV__) {
                      console.warn(`❌ [HOME_THUMBNAIL] Failed to load image: ${imageSource?.split('/').pop()}`, error)
                    }
                  }}
                />
                
                {/* Blur overlay for sensitive content */}
                {shouldBlurMessage && (
                  <ThumbnailBlurOverlay 
                    visible={true} 
                    style={styles.homeBlurOverlay}
                    intensity={30} // Lighter blur for home screen thumbnails
                    showEyeIcon={shouldBlurOneTime} // Only show eye icon for viewed one-time messages
                  />
                )}
              </View>
            )}
            
            {/* Always show media type indicator in top-left corner */}
            {mediaTypeInfo && (
              <View style={[styles.mediaTypeIndicator, { backgroundColor: mediaTypeInfo.backgroundColor }]}>
                <Ionicons 
                  name={mediaTypeInfo.icon} 
                  size={10} 
                  color={mediaTypeInfo.color} 
                />
              </View>
            )}
            
            {/* Video indicator - show on bottom right for videos with thumbnails */}
            {isVideoMessage && !showPlaceholder && (
              <View style={styles.videoIndicator}>
                <Ionicons name="play" size={12} color={Colors.white} />
              </View>
            )}

            {/* Read indicator - only show for messages sent by current user when appropriate */}
            {(isReadIndicator || showSingleCheck) && (
              <View style={[styles.readIndicator, isReadIndicator ? styles.readIndicatorSeen : styles.readIndicatorUnread]}>
                <Ionicons 
                  name={isReadIndicator ? "checkmark-done" : "checkmark"} 
                  size={10} 
                  color={Colors.white} 
                />
              </View>
            )}
          </View>
          
          <View style={styles.conversationInfo}>
            <View style={styles.pseudoContainer}>
              <Text style={styles.pseudoText}>{item.otherUser?.pseudo}</Text>
              {showUnreadBadge && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadCount}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                </View>
              )}
            </View>
            <Text style={styles.timeText}>
              {formatRelativeTime(item.created_at)}
            </Text>
            {item.caption && (
              <Text style={styles.captionText} numberOfLines={1}>
                {item.caption}
              </Text>
            )}
          </View>
        </View>
      </TouchableOpacity>
    )
    }, (prevProps, nextProps) => {
    // Production-ready comparison - only re-render when actual changes occur
    const prev = prevProps.item
    const next = nextProps.item

    const prevLast = prev.last_message || {}
    const nextLast = next.last_message || {}

    return (
      prev.id === next.id &&
      prev.has_new_message === next.has_new_message &&
      prev.otherUser?.pseudo === next.otherUser?.pseudo &&
      prev.view_once === next.view_once &&
      prev.is_nsfw === next.is_nsfw &&
      prev.latestMediaType === next.latestMediaType &&
      prev.media_url === next.media_url &&
      prev.latestThumbnailUrl === next.latestThumbnailUrl &&
      prev.caption === next.caption &&
      prev.viewed_at === next.viewed_at &&
      // Compare last_message specifics that affect the read/check UI
      prevLast.id === nextLast.id &&
      prevLast.sender_id === nextLast.sender_id &&
      prevLast.seen === nextLast.seen &&
      prev.last_seen === next.last_seen &&
      prev.last_seen_at === next.last_seen_at &&
      prevLast.read_at === nextLast.read_at &&
      prevLast.media_url === nextLast.media_url &&
      prevLast.caption === nextLast.caption
    )
  })

  ConversationItem.displayName = 'ConversationItem'

  return (
    <View style={styles.container}>
      <AppStatusBar barStyle="light-content" />
      
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>NoText.</Text>
          <TouchableOpacity 
            style={styles.settingsButton}
            onPress={() => router.push('/settings')}
          >
            <Ionicons name="settings-outline" size={20} color={Colors.white} />
          </TouchableOpacity>
        </View>
        
        <View style={[
          styles.searchContainer,
          searchResults.length > 0 && styles.searchContainerActive
        ]}>
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher un pseudo..."
            placeholderTextColor={Colors.gray500}
            value={searchQuery}
            onChangeText={handleSearchInput}
            onSubmitEditing={handleDirectSearch}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          <TouchableOpacity
            style={styles.searchButton}
            onPress={handleDirectSearch}
            disabled={conversationsLoading}
          >
            <Ionicons 
              name="search" 
              size={20} 
              color={conversationsLoading ? Colors.gray500 : Colors.white} 
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search results */}
      {searchResults.length > 0 && searchQuery.trim().length >= 2 && (
        <View style={styles.searchResultsContainer}>
          <FlatList
            data={searchResults}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.searchResultItem}
                onPress={() => selectUser(item)}
              >
                <View style={styles.searchResultContent}>
                  <View style={styles.searchResultMain}>
                    <Text style={styles.searchResultPseudo}>{item.pseudo}</Text>
                    <Text style={styles.searchResultInfo}>{item.age} ans • {item.sexe}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={Colors.gray500} />
                </View>
              </TouchableOpacity>
            )}
            style={styles.searchResultsList}
            showsVerticalScrollIndicator={false}
          />
        </View>
      )}

      {/* Conversations list - Production optimized */}
      <View style={styles.conversationListWrapper}>
        {/* Subtle swipe up indicator when conversations exist */}
        {filteredConversations.length > 0 && (
          <View style={styles.swipeIndicator}>
            <View style={styles.swipeIndicatorLine} />
          </View>
        )}
        
        <FlatList
          data={filteredConversations}
          keyExtractor={(item) => `${item.id}_${item._updateTimestamp || lastUpdate || 0}`}
          extraData={[lastUpdate, unreadCounts, blockedUsers]} // Add blockedUsers to trigger re-renders when block list changes
          renderItem={({ item }) => <ConversationItem item={item} />}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.white}
            />
          }
          // Performance optimizations
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={50}
          initialNumToRender={8}
          windowSize={10}
          getItemLayout={null} // Dynamic heights, can't optimize
          ListEmptyComponent={() => (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                Aucune conversation pour le moment
              </Text>
              <Text style={styles.emptySubtext}>
                Recherchez un pseudo pour commencer à échanger
              </Text>
            </View>
          )}
        />

        {/* Conversation Context Menu */}
        <ConversationContextMenu
          visible={showContextMenu}
          position={contextMenuPosition}
          user={selectedConversationUser}
          onClose={() => {
            setShowContextMenu(false)
            setSelectedConversationUser(null)
            setContextMenuPosition(null)
          }}
          onReport={handleReportUser}
          onBlock={handleBlockUser}
          onDelete={handleDeleteConversation}
        />

        {/* Report User Modal */}
        <ReportUserModal
          visible={showReportModal}
          onClose={() => {
            setShowReportModal(false)
            setSelectedConversationUser(null)
          }}
          reportedUser={selectedConversationUser}
          currentUser={currentUser}
          onSubmit={handleReportSubmit}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.black,
    position: 'relative',
  },
  
  // Header
  header: {
    paddingTop: getSafeAreaTop(),
    paddingHorizontal: Spacing.screen,
    paddingBottom: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray800,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
  },
  title: {
    fontSize: Typography.xxxl,
    fontWeight: Typography.light,
    color: Colors.white,
  },
  settingsButton: {
    padding: Spacing.xs,
    backgroundColor: Colors.gray900,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.gray800,
  },
  
  // Search
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.gray900,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.gray800,
  },
  searchContainerActive: {
    borderColor: Colors.gray600,
    backgroundColor: Colors.gray800,
  },
  searchInput: {
    flex: 1,
    color: Colors.white,
    fontSize: Typography.base,
    fontWeight: Typography.light,
    paddingVertical: Spacing.sm,
  },
  searchButton: {
    padding: Spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Search Results
  searchResultsContainer: {
    backgroundColor: Colors.gray900,
    marginHorizontal: Spacing.screen,
    marginTop: Spacing.xs,
    borderRadius: BorderRadius.lg,
    maxHeight: 300,
    borderWidth: 1,
    borderColor: Colors.gray700,
  },
  searchResultsList: {
    maxHeight: 300,
  },
  searchResultItem: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray800,
  },
  searchResultContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
  },
  searchResultMain: {
    flex: 1,
  },
  searchResultPseudo: {
    color: Colors.white,
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    marginBottom: Spacing.xs,
  },
  searchResultInfo: {
    color: Colors.gray400,
    fontSize: Typography.sm,
    fontWeight: Typography.light,
  },
  
  // Conversations
  conversationListWrapper: {
    flex: 1,
  },
  swipeIndicator: {
    position: 'absolute',
    top: 8,
    left: '50%',
    marginLeft: -20,
    zIndex: 10,
    opacity: 0.3,
  },
  swipeIndicatorLine: {
    width: 40,
    height: 3,
    backgroundColor: Colors.gray400,
    borderRadius: 2,
  },
  listContainer: {
    padding: Spacing.screen,
    paddingTop: Spacing.lg,
  },
  conversationItem: {
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.gray900,
    borderWidth: 1,
    borderColor: Colors.gray800,
  },
  conversationItemNew: {
    borderWidth: 2,
    borderColor: Colors.fire,
  },
  conversationContent: {
    flexDirection: 'row',
    padding: Spacing.md,
    alignItems: 'center',
  },
  
  // Media Preview
  mediaPreview: {
    width: 60,
    height: 60,
    borderRadius: BorderRadius.base,
    marginRight: Spacing.md,
    position: 'relative',
  },
  previewImage: {
    width: '100%',
    height: '100%',
    borderRadius: BorderRadius.base,
  },
  blurredImage: {
    opacity: 0.3,
  },
  imageContainer: {
    position: 'relative',
    width: '100%',
    height: '100%',
  },
  homeBlurOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: BorderRadius.base,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2, // Above image, below other UI indicators
  },
  placeholderContainer: {
    backgroundColor: Colors.gray800,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: Colors.blackOverlay,
    borderRadius: BorderRadius.xs,
    width: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5, // Above blur overlay
  },
  mediaTypeIndicator: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 16,
    height: 16,
    borderRadius: 8, // Perfect circle
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5, // Above blur overlay
    // backgroundColor will be set dynamically from mediaTypeInfo
  },
  typeIndicator: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 193, 7, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  nsfwIndicator: {
    backgroundColor: 'rgba(239, 68, 68, 0.8)', // Red background for NSFW
  },
  viewedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.blackOverlay,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: BorderRadius.base,
  },
  lockOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.blackOverlay,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: BorderRadius.base,
  },
  
  // Read indicator styles
  readIndicator: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 8,
    padding: 2,
    minWidth: 16,
    minHeight: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5, // Above blur overlay
  },
  readIndicatorSeen: {
    backgroundColor: 'rgba(34, 197, 94, 0.8)', // Green background for read
  },
  readIndicatorUnread: {
    backgroundColor: 'rgba(107, 114, 128, 0.8)', // Gray background for unread
  },
  
  // Conversation Info
  conversationInfo: {
    flex: 1,
  },
  pseudoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  pseudoText: {
    color: Colors.white,
    fontSize: Typography.lg,
    fontWeight: Typography.light,
  },
  notificationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.fire,
    marginLeft: Spacing.xs,
  },
  unreadBadge: {
    backgroundColor: Colors.fire,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    marginLeft: Spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  unreadCount: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  timeText: {
    color: Colors.gray500,
    fontSize: Typography.sm,
    fontWeight: Typography.light,
    marginBottom: Spacing.xs,
  },
  captionText: {
    color: Colors.gray400,
    fontSize: Typography.sm,
    fontWeight: Typography.light,
    fontStyle: 'italic',
  },
  
  // Empty State
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyText: {
    color: Colors.white,
    fontSize: Typography.lg,
    fontWeight: Typography.light,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  emptySubtext: {
    color: Colors.gray500,
    fontSize: Typography.base,
    fontWeight: Typography.light,
    textAlign: 'center',
  },
})

export default HomeScreen
