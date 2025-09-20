import { DeviceAuthService } from './deviceAuthService';
import { supabase } from './supabaseClient';

export const realtimeService = {
  // Real-time subscriptions
  _subscriptions: new Map(),
  _initialized: false,

  // Initialize realtime service in background
  async _initializeInBackground() {
    if (this._initialized) return;
    
    try {
      // Get current user without blocking UI
      const currentUser = await DeviceAuthService.getUser();
      if (currentUser?.id) {
        // Set online status
        this.setOnlineStatus(currentUser.id, true).catch(e => console.log('Online status error (non-critical):', e));
        this._initialized = true;
      }
    } catch (error) {
      console.log('Non-critical realtime init error:', error);
    }
  },

  // Check if user is authenticated before realtime operations
  async _ensureAuthenticated() {
    const session = await DeviceAuthService.getSession()
    if (!session) {
      throw new Error('User must be authenticated for realtime operations')
    }
    return session
  },

  // Register for push notifications (placeholder - notifications not implemented yet)
  async registerForPushNotifications() {
    try {
      await this._ensureAuthenticated()
      console.log('Push notifications not implemented yet')
      return null
    } catch (error) {
      console.error('Error getting push token:', error)
      return null
    }
  },

  // Update user's push token and online status
  async updatePushToken(userId, pushToken) {
    try {
      await this._ensureAuthenticated()
      
      const { data, error } = await supabase
        .from('users')
        .update({
          push_token: pushToken,
          last_seen: new Date().toISOString(),
          is_online: true
        })
        .eq('id', userId)
        .single()

      if (error) {
        // If columns don't exist, log but don't crash
        if (error.code === 'PGRST204') {
          console.log('Push token columns not yet available in database. Please apply database_fix.sql')
          return null
        }
        throw error
      }

      return data
    } catch (error) {
      console.error('Error updating push token:', error)
      return null
    }
  },

  // Set user online status
  async setOnlineStatus(userId, isOnline) {
    try {
      await this._ensureAuthenticated()
      // Check if columns exist before trying to update
      const { data, error } = await supabase
        .from('users')
        .update({
          is_online: isOnline,
          last_seen: new Date().toISOString()
        })
        .eq('id', userId)

      if (error) {
        // If columns don't exist, log but don't crash
        if (error.code === 'PGRST204') {
          console.log('Online status columns not yet available in database. Please apply database_fix.sql')
          return null
        }
        throw error
      }

      return data
    } catch (error) {
      console.error('Error updating online status:', error)
      // Don't throw to prevent app crashes during development
      return null
    }
  },

  // Subscribe to user online status changes
  subscribeToUserStatus(userId, callback) {
    const subscriptionKey = `user_status_${userId}`
    
    if (this._subscriptions.has(subscriptionKey)) {
      this._subscriptions.get(subscriptionKey).unsubscribe()
    }

    console.log(`📡 Setting up user status subscription for user ${userId}`)

    const subscription = supabase
      .channel(`user_status_${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'users',
          filter: `id=eq.${userId}`
        },
        (payload) => {
          console.log('👤 User status update received:', payload)
          callback(payload.new)
        }
      )
      .subscribe((status) => {
        console.log(`📡 User status subscription status: ${status}`)
      })

    this._subscriptions.set(subscriptionKey, subscription)
    return subscription
  },

  // Subscribe to new messages in a conversation
  // Subscribe to new messages for the current user (more efficient than per-conversation)
  async subscribeToUserMessages(callback) {
    try {
      await this._ensureAuthenticated()
      const currentUser = await DeviceAuthService.getCurrentUser()
      
      if (!currentUser) {
        throw new Error('No authenticated user found')
      }

      const subscriptionKey = `user_messages_${currentUser.id}`
      
      if (this._subscriptions.has(subscriptionKey)) {
        this._subscriptions.get(subscriptionKey).unsubscribe()
      }

      console.log(`📡 Setting up user messages subscription for ${currentUser.id}`)

      // Subscribe to all messages where user is sender OR receiver
      // RLS will automatically filter to only show allowed messages
      // PATCH 3: Optional - Listen only to INSERT events for conversation updates
      const subscription = supabase
        .channel(`user_messages_${currentUser.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT', // Focus on new messages only for performance
            schema: 'public',
            table: 'messages',
            filter: `or(sender_id=eq.${currentUser.id},receiver_id=eq.${currentUser.id})`
          },
          (payload) => {
            console.log('💬 Real-time message update:', payload)
            callback(payload)
          }
        )
        .subscribe((status) => {
          console.log(`📡 User messages subscription status: ${status}`)
        })

      this._subscriptions.set(subscriptionKey, subscription)
      return subscription
    } catch (error) {
      console.error('Error subscribing to user messages:', error)
      throw error
    }
  },

  // Subscribe to user status updates (if you need this feature)
  async subscribeToUserStatus(userId, callback) {
    try {
      await this._ensureAuthenticated()
      
      const subscriptionKey = `user_status_${userId}`
      
      if (this._subscriptions.has(subscriptionKey)) {
        this._subscriptions.get(subscriptionKey).unsubscribe()
      }

      console.log(`📡 Setting up user status subscription for ${userId}`)

      const subscription = supabase
        .channel(`user_status_${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'users',
            filter: `id=eq.${userId}`
          },
          (payload) => {
            console.log('� User status update received:', payload)
            callback(payload.new)
          }
        )
        .subscribe((status) => {
          console.log(`📡 User status subscription status: ${status}`)
        })

      this._subscriptions.set(subscriptionKey, subscription)
      return subscription
    } catch (error) {
      console.error('Error subscribing to user status:', error)
      throw error
    }
  },

  // Legacy method for backward compatibility
  subscribeToConversation(currentUserId, otherUserId, callback) {
    console.warn('subscribeToConversation is deprecated. Use subscribeToUserMessages instead.')
    
    // Create a subscription key for this conversation
    const subscriptionKey = `conversation_${currentUserId}_${otherUserId}`;
    
    if (this._subscriptions.has(subscriptionKey)) {
      this._subscriptions.get(subscriptionKey).unsubscribe();
    }
    
    // Create a direct subscription to ensure we have a proper channel object with unsubscribe
    const subscription = supabase
      .channel(subscriptionKey)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `or(and(sender_id.eq.${currentUserId},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${currentUserId}))`
        },
        (payload) => {
          console.log('💬 Real-time conversation update:', payload);
          callback(payload);
        }
      )
      .subscribe((status) => {
        console.log(`📡 Conversation subscription status: ${status}`);
      });
    
    this._subscriptions.set(subscriptionKey, subscription);
    return subscription;
  },

  // Subscribe to all conversations for home screen
  subscribeToAllConversations(currentUserId, callback) {
    const subscriptionKey = `all_conversations_${currentUserId}`
    
    if (this._subscriptions.has(subscriptionKey)) {
      this._subscriptions.get(subscriptionKey).unsubscribe()
    }

    console.log(`📡 Setting up all conversations subscription for user ${currentUserId}`)
    console.log(`🔍 [SUPABASE DEBUG] Real-time filter: or(sender_id.eq.${currentUserId},receiver_id.eq.${currentUserId})`)

    const subscription = supabase
      .channel(`all_conversations_${currentUserId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `or(sender_id.eq.${currentUserId},receiver_id.eq.${currentUserId})`
        },
        (payload) => {
          console.log('🔥🔥🔥 [SUPABASE DEBUG] REAL-TIME EVENT RECEIVED!')
          console.log('🔥 [SUPABASE DEBUG] User ID:', currentUserId)
          console.log('🔥 [SUPABASE DEBUG] Payload:', JSON.stringify(payload, null, 2))
          console.log('🔥 [SUPABASE DEBUG] Event type:', payload.eventType)
          console.log('🔥 [SUPABASE DEBUG] Table:', payload.table)
          if (payload.new) {
            console.log('🔥 [SUPABASE DEBUG] New record sender_id:', payload.new.sender_id)
            console.log('🔥 [SUPABASE DEBUG] New record receiver_id:', payload.new.receiver_id)
          }
          callback(payload)
        }
      )
      .subscribe((status) => {
        console.log(`📡 All conversations subscription status: ${status}`)
        if (status === 'SUBSCRIBED') {
          console.log(`✅ [SUPABASE DEBUG] Successfully subscribed to real-time for user: ${currentUserId}`)
        } else if (status === 'CHANNEL_ERROR') {
          console.error(`❌ [SUPABASE DEBUG] Real-time subscription error for user: ${currentUserId}`)
        } else if (status === 'TIMED_OUT') {
          console.error(`⏰ [SUPABASE DEBUG] Real-time subscription timed out for user: ${currentUserId}`)
        } else if (status === 'CLOSED') {
          console.log(`🔒 [SUPABASE DEBUG] Real-time subscription closed for user: ${currentUserId}`)
        }
      })

    this._subscriptions.set(subscriptionKey, subscription)
    return subscription
  },

  // Mark messages as read and delivered
  async markMessagesAsRead(messageIds, currentUserId) {
    try {
      const { data, error } = await supabase
        .from('messages')
        .update({
          read_at: new Date().toISOString(),
          read_by: currentUserId
        })
        .in('id', messageIds)
        .neq('sender_id', currentUserId) // Don't mark own messages as read

      if (error) {
        // If columns don't exist, log but don't crash
        if (error.code === 'PGRST204') {
          console.log('Read status columns not yet available in database. Please apply database_fix.sql')
          return null
        }
        throw error
      }

      return data
    } catch (error) {
      console.error('Error marking messages as read:', error)
      return null
    }
  },

  // Mark message as delivered
  async markMessageAsDelivered(messageId) {
    try {
      const { data, error } = await supabase
        .from('messages')
        .update({
          delivered_at: new Date().toISOString()
        })
        .eq('id', messageId)
        .single()

      if (error) {
        throw error
      }

      return data
    } catch (error) {
      console.error('Error marking message as delivered:', error)
      throw error
    }
  },

  // Get unread message count
  async getUnreadCount(userId) {
    try {
      const { count, error } = await supabase
        .from('messages')
        .select('id', { count: 'exact' })
        .neq('sender_id', userId)
        .is('read_at', null)

      if (error) {
        throw error
      }

      return count || 0
    } catch (error) {
      console.error('Error getting unread count:', error)
      return 0
    }
  },

  // Initialize real-time features for user
  async initializeRealtimeFeatures(userId) {
    try {
      console.log(`🚀 Initializing real-time features for user ${userId}`)
      
      // Always set user as online first
      console.log('🟢 Setting user online...')
      await this.setOnlineStatus(userId, true)
      
      // Register for push notifications (optional)
      const pushToken = await this.registerForPushNotifications()
      
      if (pushToken) {
        // Update user with push token
        await this.updatePushToken(userId, pushToken)
        console.log('📱 Push notifications registered successfully')
      } else {
        console.log('📱 Push notifications not available (Expo Go or simulator)')
      }
      
      console.log('✅ Real-time features initialized successfully')
      return { pushToken, isOnline: true }
    } catch (error) {
      console.error('Error initializing realtime features:', error)
      // Don't throw error to prevent app crashes
      return { pushToken: null, isOnline: false }
    }
  },

  // Cleanup when user goes offline
  async cleanup(userId) {
    try {
      // Set user as offline
      if (userId) {
        await this.setOnlineStatus(userId, false)
      }

      // Unsubscribe from all real-time subscriptions
      this.unsubscribeAll()
      
      console.log('Realtime service cleanup completed')
    } catch (error) {
      console.error('Error during cleanup:', error)
    }
  },

  // Cleanup subscriptions
  unsubscribeAll() {
    this._subscriptions.forEach(subscription => {
      subscription.unsubscribe()
    })
    this._subscriptions.clear()
  },

  // Unsubscribe from specific subscription
  unsubscribe(subscriptionKey) {
    if (this._subscriptions.has(subscriptionKey)) {
      this._subscriptions.get(subscriptionKey).unsubscribe()
      this._subscriptions.delete(subscriptionKey)
    }
  }
}

// Auto-cleanup on app state changes
import { AppState } from 'react-native';

let appStateSubscription = null

export const initializeAppStateHandling = () => {
  if (appStateSubscription) {
    appStateSubscription.remove()
  }

  appStateSubscription = AppState.addEventListener('change', async (nextAppState) => {
    try {
      const currentUser = await getCurrentUser()
      if (!currentUser) return

      if (nextAppState === 'active') {
        // App became active - set user online
        await realtimeService.setOnlineStatus(currentUser.id, true)
      } else if (nextAppState === 'background' || nextAppState === 'inactive') {
        // App went to background - set user offline
        await realtimeService.setOnlineStatus(currentUser.id, false)
      }
    } catch (error) {
      console.error('Error handling app state change:', error)
    }
  })
}

// Clean up app state subscription
export const cleanupAppStateHandling = () => {
  if (appStateSubscription) {
    appStateSubscription.remove()
    appStateSubscription = null
  }
}
