/**
 * ConversationService - Handles conversation-specific operations including deletion
 * Follows similar patterns to deviceAuthService for consistency
 */

import { supabase } from './supabaseClient'
import { getUserData } from '../utils/secureStore'

class ConversationService {
  /**
   * Delete a complete conversation between the current user and a peer
   * This will remove all messages and clear local caches for this conversation
   */
  static async deleteConversation(peerId, peerPseudo = null) {
    try {
      console.log('🗑️ Starting conversation deletion...', { peerId, peerPseudo })
      
      // Get current user data
      const userData = await getUserData()
      if (!userData || !userData.id) {
        throw new Error('No user data found - cannot delete conversation')
      }

      const currentUserId = userData.id
      console.log(`🗑️ Deleting conversation between ${userData.pseudo} (${currentUserId}) and peer ${peerPseudo || peerId} (${peerId})`)

      // 1. Delete all messages between the two users from database
      try {
        console.log('🗑️ Deleting all messages between users...')
        
        // Delete messages where both users are participants
        // Using .in() approach which works reliably
        const { data: deletedMessages, error: deleteMessagesError } = await supabase
          .from('messages')
          .delete()
          .in('sender_id', [currentUserId, peerId])
          .in('receiver_id', [currentUserId, peerId])
          .select('id')

        if (deleteMessagesError) {
          console.error('❌ Error deleting messages:', deleteMessagesError)
          throw new Error(`Failed to delete messages: ${deleteMessagesError.message}`)
        }

        const deletedCount = deletedMessages ? deletedMessages.length : 0
        console.log(`✅ Successfully deleted ${deletedCount} messages from database`)

      } catch (messageError) {
        console.error('❌ Error in message deletion:', messageError)
        throw new Error(`Message deletion failed: ${messageError.message}`)
      }

      // 2. Clear local media cache for this conversation
      try {
        console.log('🗑️ Clearing local media cache for conversation...')
        const { unifiedMediaService } = await import('./unifiedMediaService')
        
        // Clear conversation-specific cache if method exists
        if (typeof unifiedMediaService.clearConversationCache === 'function') {
          await unifiedMediaService.clearConversationCache(currentUserId, peerId)
          console.log('✅ Conversation media cache cleared successfully')
        } else {
          console.log('ℹ️ No conversation-specific cache clearing available, will clear general cache')
          // Clear general cache as fallback - this might clear more than needed but ensures cleanup
          unifiedMediaService.clearCache()
          console.log('✅ General media cache cleared as fallback')
        }
      } catch (mediaError) {
        console.error('❌ Error clearing media cache:', mediaError)
        // Continue with deletion even if cache clearing fails
      }

      // 3. Clear conversation from local cache service
      try {
        console.log('🗑️ Clearing conversation from local caches...')
        const { default: CacheService } = await import('./cacheService')
        
        // Clear conversation-specific caches
        // Create consistent cache keys that match the app's pattern
        const conversationKeys = [
          `conversation_${currentUserId}_${peerId}`,
          `conversation_${peerId}_${currentUserId}`,
          `messages_${currentUserId}_${peerId}`,
          `messages_${peerId}_${currentUserId}`,
          `unread_${currentUserId}_${peerId}`,
          `unread_${peerId}_${currentUserId}`
        ]

        for (const key of conversationKeys) {
          try {
            CacheService.delete('conversation', key)
            CacheService.delete('message', key)
          } catch (keyError) {
            console.log(`ℹ️ Cache key ${key} not found or already cleared`)
          }
        }

        console.log('✅ Local conversation caches cleared successfully')
      } catch (cacheError) {
        console.error('❌ Error clearing local caches:', cacheError)
        // Continue with deletion even if cache clearing fails
      }

      // 4. Clean up real-time subscriptions for this conversation
      try {
        console.log('🗑️ Cleaning up real-time subscriptions for conversation...')
        const { realtimeCacheManager } = await import('./realtimeCacheManager')
        
        if (realtimeCacheManager && typeof realtimeCacheManager.cleanupConversationSubscriptions === 'function') {
          await realtimeCacheManager.cleanupConversationSubscriptions(currentUserId, peerId)
          console.log('✅ Real-time conversation subscriptions cleaned up successfully')
        } else if (realtimeCacheManager && typeof realtimeCacheManager.cleanup === 'function') {
          // Fallback to general cleanup if conversation-specific method doesn't exist
          console.log('ℹ️ Using general subscription cleanup as fallback')
          realtimeCacheManager.cleanup()
          console.log('✅ General real-time subscriptions cleaned up')
        } else {
          console.log('ℹ️ No real-time cache manager cleanup available')
        }
      } catch (realtimeError) {
        console.error('❌ Error cleaning up real-time subscriptions:', realtimeError)
        // Continue with deletion even if real-time cleanup fails
      }

      // 5. Clear conversation from AsyncStorage if cached there
      try {
        console.log('🗑️ Clearing conversation from AsyncStorage...')
        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default
        
        // Clear potential AsyncStorage keys for this conversation
        const storageKeys = [
          `conversation_${currentUserId}_${peerId}`,
          `conversation_${peerId}_${currentUserId}`,
          `messages_${currentUserId}_${peerId}`,
          `messages_${peerId}_${currentUserId}`,
          `lastMessage_${currentUserId}_${peerId}`,
          `lastMessage_${peerId}_${currentUserId}`
        ]

        await AsyncStorage.multiRemove(storageKeys)
        console.log('✅ Conversation AsyncStorage entries cleared successfully')
      } catch (storageError) {
        console.error('❌ Error clearing AsyncStorage:', storageError)
        // Continue even if storage clearing fails
      }

      console.log('🎉 Conversation deletion completed successfully')
      return { 
        success: true, 
        message: `Conversation with ${peerPseudo || 'user'} deleted successfully`,
        deletedPeer: { id: peerId, pseudo: peerPseudo }
      }

    } catch (error) {
      console.error('❌ ConversationService.deleteConversation error:', error)
      throw new Error(`Conversation deletion failed: ${error.message}`)
    }
  }

  /**
   * Check if a conversation exists between current user and peer
   */
  static async conversationExists(peerId) {
    try {
      const userData = await getUserData()
      if (!userData || !userData.id) {
        return false
      }

      const { data, error } = await supabase
        .from('messages')
        .select('id')
        .or(`and(sender_id.eq.${userData.id},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${userData.id})`)
        .limit(1)

      if (error) {
        console.error('Error checking conversation existence:', error)
        return false
      }

      return data && data.length > 0
    } catch (error) {
      console.error('Error in conversationExists:', error)
      return false
    }
  }

  /**
   * Get message count for a conversation
   */
  static async getConversationMessageCount(peerId) {
    try {
      const userData = await getUserData()
      if (!userData || !userData.id) {
        return 0
      }

      const { count, error } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .or(`and(sender_id.eq.${userData.id},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${userData.id})`)

      if (error) {
        console.error('Error getting message count:', error)
        return 0
      }

      return count || 0
    } catch (error) {
      console.error('Error in getConversationMessageCount:', error)
      return 0
    }
  }
}

export default ConversationService
