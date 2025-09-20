import AsyncStorage from '@react-native-async-storage/async-storage'
import { getOrCreateDeviceId, getUserData } from '../utils/secureStore'
import { dedupe } from './dedupe'
import { DeviceAuthService } from './deviceAuthService'
import { supabase } from './supabaseClient'

// Import API manager for centralized API calls
import { apiManager } from './apiManager'

// Import realtimeCacheManager lazily to avoid circular dependency
let realtimeCacheManager = null
const getRealtimeCacheManager = async () => {
  if (!realtimeCacheManager) {
    try {
      const module = await import('./realtimeCacheManager')
      realtimeCacheManager = module.realtimeCacheManager
    } catch (e) {
      // Handle case where module isn't available
    }
  }
  return realtimeCacheManager
}

// Debug logging utility for API requests
const debugLog = (service, operation, data = null) => {
  const timestamp = new Date().toISOString()
  const logMessage = `🔍 [${service.toUpperCase()} API DEBUG] ${timestamp} - ${operation}`
  
  if (data) {
    console.log(`${logMessage}:`, data)
  } else {
    console.log(logMessage)
  }
}

// Optimized getCurrentUser with caching and deduplication to prevent duplicate API calls
export const getCurrentUserCached = () =>
  dedupe('currentUser', async () => {
    debugLog('userService', 'getCurrentUserCached_DEDUPE_START')
    
    // Get user data directly from secure storage to avoid circular dependency
    const userData = await getUserData()
    if (!userData?.id) {
      debugLog('userService', 'getCurrentUserCached_NO_USER_ID')
      return null
    }
    
    try {
      // PATCH 7: Use skinny select to reduce payload (removed avatar_url as it doesn't exist)
      const { data, error } = await supabase
        .from('users')
        .select('id,pseudo,updated_at')
        .eq('id', userData.id)
        .single()
      
      if (error) {
        debugLog('userService', 'getCurrentUserCached_ERROR', { error: error.message })
        return null
      }
      
      debugLog('userService', 'getCurrentUserCached_SUCCESS', { pseudo: data.pseudo })
      return data
    } catch (error) {
      debugLog('userService', 'getCurrentUserCached_CATCH', { error: error.message })
      return null
    }
  })

// Legacy createUser function - now uses DeviceAuthService
export const createUser = async (pseudo, age, sexe = 'Autre') => {
  try {
    const result = await DeviceAuthService.register(pseudo, age, sexe)
    return result.user
  } catch (error) {
    throw error
  }
}

// Updated getCurrentUser to work with JWT authentication
export const getCurrentUser = async () => {
  try {
    debugLog('userService', 'getCurrentUser_START')
    
    // Check if we have a valid session first
    const session = await DeviceAuthService.getSession()
    if (!session) {
      debugLog('userService', 'getCurrentUser_NO_SESSION')
      return null
    }
    
    const userData = await getUserData()
    debugLog('userService', 'getCurrentUser_LOCAL_DATA', { 
      hasLocalData: !!userData, 
      userId: userData?.id 
    })
    
    if (!userData) {
      debugLog('userService', 'getCurrentUser_NO_LOCAL_DATA')
      return null
    }
    
    // Verify the user still exists in the database (with JWT auth)
    debugLog('supabase', 'getCurrentUser_DB_QUERY_START', { userId: userData.id })
    // PATCH 7: Use skinny select to reduce payload (removed avatar_url as it doesn't exist)
    const { data, error } = await supabase
      .from('users')
      .select('id,pseudo,updated_at,age,sexe')
      .eq('id', userData.id)
      .maybeSingle()
    
    debugLog('supabase', 'getCurrentUser_DB_QUERY_RESPONSE', { 
      success: !error,
      hasData: !!data,
      error: error?.message,
      userId: data?.id,
      pseudo: data?.pseudo
    })
    
    if (error || !data) {
      debugLog('userService', 'getCurrentUser_DB_VALIDATION_FAILED', { 
        error: error?.message,
        dataExists: !!data 
      })
      return null
    }
    
    debugLog('userService', 'getCurrentUser_SUCCESS', { 
      userId: data.id,
      pseudo: data.pseudo,
      age: data.age,
      sexe: data.sexe
    })
    return data
  } catch (error) {
    debugLog('userService', 'getCurrentUser_ERROR', { error: error.message })
    return null
  }
}

export const findUserByPseudo = async (pseudo) => {
  try {
    debugLog('userService', 'findUserByPseudo_START', { pseudo })
    
    debugLog('supabase', 'findUserByPseudo_DB_QUERY_START', { searchPseudo: pseudo })
        // PATCH 7: Use skinny select to reduce payload (removed avatar_url as it doesn't exist)
    const { data, error } = await supabase
      .from('users')
      .select('id,pseudo,updated_at,age,sexe')
      .eq('pseudo', pseudo.trim().toLowerCase())
      .single()
    
    debugLog('supabase', 'findUserByPseudo_DB_QUERY_RESPONSE', { 
      success: !error,
      error: error?.message,
      found: !!data,
      userId: data?.id,
      returnedPseudo: data?.pseudo
    })
    
    if (error) {
      debugLog('userService', 'findUserByPseudo_ERROR', { error: error.message })
      throw error
    }
    
    debugLog('userService', 'findUserByPseudo_SUCCESS', { 
      userId: data.id,
      pseudo: data.pseudo,
      age: data.age,
      sexe: data.sexe
    })
    return data
  } catch (error) {
    debugLog('userService', 'findUserByPseudo_CATCH_ERROR', { error: error.message })
    return null
  }
}

export const findUserByUserId = async (userId) => {
  try {
    debugLog('userService', 'findUserByUserId_START', { userId })
    
    debugLog('supabase', 'findUserByUserId_DB_QUERY_START', { searchUserId: userId })
    // PATCH 7: Use skinny select to reduce payload (removed avatar_url as it doesn't exist)
    const { data, error } = await supabase
      .from('users')
      .select('id,pseudo,updated_at,age,sexe')
      .eq('id', userId)
      .single()
    
    debugLog('supabase', 'findUserByUserId_DB_QUERY_RESPONSE', { 
      success: !error,
      error: error?.message,
      found: !!data,
      userId: data?.id,
      returnedPseudo: data?.pseudo
    })
    
    if (error) {
      debugLog('userService', 'findUserByUserId_ERROR', { error: error.message })
      throw error
    }
    
    debugLog('userService', 'findUserByUserId_SUCCESS', { 
      userId: data.id,
      pseudo: data.pseudo,
      age: data.age,
      sexe: data.sexe
    })
    return data
  } catch (error) {
    debugLog('userService', 'findUserByUserId_CATCH_ERROR', { error: error.message })
    return null
  }
}
export const sendMessage = async (receiverId, mediaUrl, mediaType, caption = null, mediaMode = 'permanent', thumbnailUrl = null, isMuted = false) => {
  try {
    console.log(`🔍 [USERSERVICE] sendMessage called with:`, { 
      receiverId, 
      mediaUrl: mediaUrl ? 'present' : 'none', 
      mediaType,
      caption,
      mediaMode,
      thumbnailUrl: thumbnailUrl ? 'present' : 'none',
      isMuted
    })
    
    if (!receiverId) {
      throw new Error('Receiver ID is required')
    }
    
    if (!mediaUrl) {
      throw new Error('Media URL is required')
    }
    
    const currentUser = await getCurrentUserCached() // Use cached version
    if (!currentUser) throw new Error('User not authenticated')
    
    // CRITICAL FIX: Make sure we have a fresh session with valid JWT
    debugLog('userService', 'sendMessage_REFRESH_SESSION', { refreshing: true })
    await supabase.auth.refreshSession()
    
    // Verify session is valid after refresh
    const { data: { session }, error: sessErr } = await supabase.auth.getSession()
    if (!session || sessErr) {
      debugLog('userService', 'sendMessage_SESSION_ERROR', { error: sessErr?.message })
      throw new Error("Session refresh failed")
    }
    
    debugLog('userService', 'sendMessage_SESSION_VALID', { 
      authenticated: true,
      hasSession: !!session,
      receiver: receiverId
    })
    
    // Determine view properties based on media mode
    let viewOnce = false
    let isNsfw = false
    let autoDeleteAfter = null
    switch (mediaMode) {
      case 'one_time':
        viewOnce = true
        break
      case 'nsfw':
        isNsfw = true
        // No special handling needed - treat as normal message with flame indicator
        break
      case 'permanent':
      default:
        // Default values already set
        break
    }
    
    // FIXED: Rely on DEFAULT constraint for sender_id (from JWT auth.uid())
    debugLog('userService', 'sendMessage_INSERT_START', { 
      receiverId,
      hasMedia: !!mediaUrl,
      mediaType,
      hasThumbnail: !!thumbnailUrl
    })
    
    // P7 FIX: Use minimal return but still get essential data for optimistic updates
    const { data, error } = await supabase
      .from('messages')
      .insert({
        // sender_id is automatically filled by DEFAULT constraint from JWT
        receiver_id: receiverId,
        media_url: mediaUrl,
        media_type: mediaType,
        caption,
        view_once: viewOnce,
        is_nsfw: isNsfw,
        auto_delete_after: autoDeleteAfter,
        thumbnail_url: thumbnailUrl,
        is_muted: isMuted
      })
      .select('id, created_at, sender_id') // P7 FIX: Only essential fields for cache updates
      .single()
      
    if (error) throw error

    // CRITICAL FIX: Update conversation cache immediately after sending message
    try {
      const rtCacheManager = await getRealtimeCacheManager()
      if (rtCacheManager && data) {
        debugLog('userService', 'sendMessage_UPDATE_CACHE_START', { 
          messageId: data.id,
          receiverId,
          senderId: data.sender_id
        })
        
        // P7 FIX: Reconstruct complete message object for optimistic updates
        const completeMessage = {
          id: data.id,
          created_at: data.created_at,
          sender_id: data.sender_id,
          receiver_id: receiverId,
          media_url: mediaUrl,
          media_type: mediaType,
          caption,
          view_once: viewOnce,
          is_nsfw: isNsfw,
          auto_delete_after: autoDeleteAfter,
          thumbnail_url: thumbnailUrl,
          is_muted: isMuted,
          seen: false,
          viewed_at: null
        }
        
        // IMPROVED: Directly update cache with the complete message instead of API call
        await rtCacheManager.updateConversationCacheWithNewMessage(completeMessage)
        
        // CRITICAL FIX: Force apiManager cache update for both sender and receiver perspectives
        // P2 FIX: Keep optimistic updates and realtime, remove aggressive invalidation
        const { apiManager } = await import('./apiManager')
        
        // P2 FIX: Only update message cache, not conversations (realtime will handle that)
        const bidirectionalKeys = [
          `messages_currentUserId:${currentUser.id}|otherUserId:${receiverId}`,
          `messages_currentUserId:${receiverId}|otherUserId:${currentUser.id}`
        ]
        
        // Get existing messages and merge the new one into both perspectives safely
        const mergeIntoCache = (key, incoming) => {
          try {
            let existing = apiManager.getFromCache(key)
            if (!Array.isArray(existing)) existing = []

            // Matching heuristic to detect optimistic replacements
            const matchesExisting = (existingMsg) => {
              if (!existingMsg) return false
              try {
                if (incoming.id && existingMsg.id === incoming.id) return true
                if (incoming.id && (existingMsg._tempId === incoming.id || existingMsg.tempId === incoming.id)) return true
                if ((incoming._tempId || incoming.tempId) && existingMsg.id && (existingMsg.id === incoming._tempId || existingMsg.id === incoming.tempId)) return true
              } catch (e) {}
              return false
            }

            const idx = existing.findIndex(matchesExisting)
            if (idx >= 0) {
              existing[idx] = { ...existing[idx], ...incoming }
            } else {
              existing.push(incoming)
            }

            // Dedupe prefer non-optimistic and keep order, then keep last 30 as a safety cap
            const seen = new Set()
            const dedupedReversed = []
            for (let i = existing.length - 1; i >= 0; i--) {
              const m = existing[i]
              if (!m) continue
              const ids = [m.id, m._tempId, m.tempId].filter(Boolean)
              const already = ids.some(id => seen.has(id))
              if (already) continue
              ids.forEach(id => seen.add(id))
              dedupedReversed.push(m)
            }
            const merged = dedupedReversed.reverse().slice(-30)

            // Persist merged array back to authoritative cache
            apiManager.setCache(key, merged)
          } catch (err) {
            // Silent fail - cache will be refreshed on next fetch
          }
        }

        bidirectionalKeys.forEach(key => mergeIntoCache(key, completeMessage))
        
        debugLog('userService', 'sendMessage_CACHE_UPDATED', { 
          messageId: data.id,
          directUpdate: true,
          optimisticOnly: true  // P2 FIX: No aggressive invalidation
        })
        
        // Emit event for immediate UI updates
        // Emit realtime events with complete message object
        rtCacheManager.emit('messageSent', {
          message: completeMessage,
          otherUserId: receiverId
        })
        
        // CRITICAL: Also emit conversationUpdate for HomeScreen to update immediately
        rtCacheManager.emit('conversationUpdate', {
          type: 'newMessage',
          message: completeMessage,
          conversationId: receiverId
        })
        
        // CRITICAL: Also emit messageReceived for consistent handling
        rtCacheManager.emit('messageReceived', {
          message: completeMessage,
          conversationId: receiverId
        })
      }
    } catch (cacheError) {
      // Don't fail the message send if cache update fails
      debugLog('userService', 'sendMessage_CACHE_UPDATE_ERROR', { 
        error: cacheError.message,
        messageId: data?.id
      })
    }
    
    // P7 FIX: Return the complete message object for UI updates
    const completeMessage = {
      id: data.id,
      created_at: data.created_at,
      sender_id: data.sender_id,
      receiver_id: receiverId,
      media_url: mediaUrl,
      media_type: mediaType,
      caption,
      view_once: viewOnce,
      is_nsfw: isNsfw,
      auto_delete_after: autoDeleteAfter,
      thumbnail_url: thumbnailUrl,
      is_muted: isMuted,
      seen: false,
      viewed_at: null
    }
    
    return completeMessage
  } catch (error) {
    throw error
  }
}
// DEPRECATED: Use apiManager.getConversations() instead
export const getConversations = async () => {
  console.warn('⚠️ getConversations() is deprecated. Use apiManager.getConversations() instead.')
  const currentUser = await getCurrentUserCached()
  if (!currentUser) return []
  return await apiManager.getConversations(currentUser.id)
}
// DEPRECATED: Use apiManager.getConversations() instead  
export const getConversationsOptimized = async (currentUser) => {
  console.warn('⚠️ getConversationsOptimized() is deprecated. Use apiManager.getConversations() instead.')
  let user = currentUser
  if (!user) {
    user = await getCurrentUserCached()
  }
  if (!user) return []
  return await apiManager.getConversations(user.id)
}
export const getMessagesWithUser = async (otherUserId, currentUser = null) => {
  try {
    if (!otherUserId) {
      return []
    }
    
    // Use provided currentUser or get from API manager
    const user = currentUser || await apiManager.getCurrentUser()
    if (!user) return []
    
    // Use centralized API manager for message fetching
    return await apiManager.getMessages(user.id, otherUserId)
  } catch (error) {
    console.error('Error in getMessagesWithUser:', error)
    return []
  }
}
export const markMessageAsSeen = async (messageId, currentUserId, markAsSeen = true) => {
  try {
    // We no longer set `seen` per-message here.
    // This function remains only to mark `viewed_at` for one-time/view-once flows when markAsSeen === false.
    if (!markAsSeen) {
      const { error } = await supabase
        .from('messages')
        .update({ viewed_at: new Date().toISOString() })
        .eq('id', messageId)
        .eq('receiver_id', currentUserId)
        .is('viewed_at', null)
      if (error) throw error
    }
  } catch (error) {
    console.error('❌ [DEBUG_READ] markMessageAsSeen error:', error)
    throw error
  }
}

export const searchUsersByPseudo = async (searchTerm) => {
  try {
    debugLog('userService', 'searchUsersByPseudo_START', { 
      searchTerm,
      termLength: searchTerm?.length,
      validSearch: searchTerm && searchTerm.trim().length >= 2
    })
    
    if (!searchTerm || searchTerm.trim().length < 2) {
      debugLog('userService', 'searchUsersByPseudo_INVALID_TERM', { 
        reason: 'term_too_short_or_empty',
        termLength: searchTerm?.length || 0
      })
      return []
    }
    
    // Use centralized API manager for user search
    return await apiManager.searchUsers(searchTerm)
  } catch (error) {
    debugLog('userService', 'searchUsersByPseudo_CATCH_ERROR', { error: error.message })
    return []
  }
}
export const deleteUserAccount = async () => {
  try {
    const currentUser = await getCurrentUserCached() // Use cached version
    if (!currentUser) throw new Error('User not authenticated')
    // 1. Clear local media cache (server deletion handled by database)
    const { unifiedMediaService } = await import('./unifiedMediaService')
    unifiedMediaService.clearCache()
    // 2. Delete all messages involving this user
    const { error: deleteMessagesError } = await supabase
      .from('messages')
      .delete()
      .or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`)
    if (deleteMessagesError) {
      throw deleteMessagesError
    }
    // 3. Delete the user account
    const { error: deleteUserError } = await supabase
      .from('users')
      .delete()
      .eq('id', currentUser.id)
    if (deleteUserError) {
      throw deleteUserError
    }
    // 4. Clear local storage
    const deviceId = await getOrCreateDeviceId()
    await AsyncStorage.multiRemove([
      `userData_${deviceId}`,
      'user_data'
    ])
    return true
  } catch (error) {
    throw error
  }
}
