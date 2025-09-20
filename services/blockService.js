import AsyncStorage from '@react-native-async-storage/async-storage'

const BLOCKED_USERS_KEY = 'blocked_users'
const BLOCKED_USERS_DETAILS_KEY = 'blocked_users_details'

class BlockService {
  constructor() {
    this.blockedUsers = new Set()
    this.blockedUsersDetails = new Map() // Store user details
    this.listeners = new Set()
    this.initialized = false
  }

  async initialize() {
    if (this.initialized) return
    
    try {
      console.log('📵 [BLOCK] Starting initialization...')
      console.log('📵 [BLOCK] Storage keys:', { BLOCKED_USERS_KEY, BLOCKED_USERS_DETAILS_KEY })
      
      // Test basic AsyncStorage functionality first
      try {
        const testKey = 'test_async_storage'
        const testValue = 'test_value_123'
        await AsyncStorage.setItem(testKey, testValue)
        const retrievedValue = await AsyncStorage.getItem(testKey)
        await AsyncStorage.removeItem(testKey)
        console.log('📵 [BLOCK] AsyncStorage test:', { 
          stored: testValue, 
          retrieved: retrievedValue, 
          working: testValue === retrievedValue 
        })
      } catch (testError) {
        console.error('📵 [BLOCK] AsyncStorage test failed:', testError)
      }
      
      // Load blocked user IDs
      const stored = await AsyncStorage.getItem(BLOCKED_USERS_KEY)
      console.log('📵 [BLOCK] Raw stored data:', stored)
      
      if (stored) {
        const blockedList = JSON.parse(stored)
        this.blockedUsers = new Set(blockedList)
        console.log('📵 [BLOCK] Initialized with blocked users:', {
          raw: stored,
          parsed: blockedList,
          length: blockedList.length,
          setSize: this.blockedUsers.size,
          setContents: Array.from(this.blockedUsers)
        })
      } else {
        console.log('📵 [BLOCK] No stored blocked users found - null or undefined')
      }
      
      // Load blocked user details
      const storedDetails = await AsyncStorage.getItem(BLOCKED_USERS_DETAILS_KEY)
      console.log('📵 [BLOCK] Raw stored details:', storedDetails)
      
      if (storedDetails) {
        const detailsObject = JSON.parse(storedDetails)
        this.blockedUsersDetails = new Map(Object.entries(detailsObject))
        console.log('📵 [BLOCK] Loaded user details for', this.blockedUsersDetails.size, 'users')
      }
      
      console.log('📵 [BLOCK] Final state after initialization:', {
        blockedUsersSize: this.blockedUsers.size,
        blockedUsersArray: Array.from(this.blockedUsers),
        detailsSize: this.blockedUsersDetails.size,
        initialized: true
      })
      
      this.initialized = true
    } catch (error) {
      console.error('❌ [BLOCK] Failed to initialize:', error)
      this.blockedUsers = new Set()
      this.blockedUsersDetails = new Map()
      this.initialized = true
    }
  }

  async blockUser(userId, userDetails = null) {
    console.log('📵 [BLOCK] blockUser called with:', { userId, userDetails })
    await this.initialize()
    
    if (this.blockedUsers.has(userId)) {
      console.log('📵 [BLOCK] User already blocked:', userId)
      return false
    }

    console.log('📵 [BLOCK] Adding user to blocked set:', userId)
    this.blockedUsers.add(userId)
    console.log('📵 [BLOCK] Set size after add:', this.blockedUsers.size)
    
    // Store user details if provided
    if (userDetails) {
      if (typeof userDetails === 'string') {
        // If userDetails is just a pseudo string
        const details = {
          id: userId,
          pseudo: userDetails,
          age: null,
          sexe: null
        }
        this.blockedUsersDetails.set(userId, details)
        console.log('📵 [BLOCK] Stored details (string):', details)
      } else {
        // If userDetails is a full user object
        const details = {
          id: userId,
          pseudo: userDetails.pseudo || `Utilisateur ${userId}`,
          age: userDetails.age || null,
          sexe: userDetails.sexe || null
        }
        this.blockedUsersDetails.set(userId, details)
        console.log('📵 [BLOCK] Stored details (object):', details)
      }
    } else {
      // Fallback if no details provided
      const details = {
        id: userId,
        pseudo: `Utilisateur ${userId}`,
        age: null,
        sexe: null
      }
      this.blockedUsersDetails.set(userId, details)
      console.log('📵 [BLOCK] Stored details (fallback):', details)
    }
    
    console.log('📵 [BLOCK] About to save to storage...')
    await this.saveToStorage()
    console.log('📵 [BLOCK] Save completed, notifying listeners...')
    this.notifyListeners()
    
    console.log('📵 [BLOCK] User blocked successfully:', { 
      userId, 
      userDetails, 
      total: this.blockedUsers.size,
      blockedArray: Array.from(this.blockedUsers)
    })
    return true
  }

  async unblockUser(userId) {
    await this.initialize()
    
    if (!this.blockedUsers.has(userId)) {
      console.log('📵 [BLOCK] User not blocked:', userId)
      return false
    }

    this.blockedUsers.delete(userId)
    this.blockedUsersDetails.delete(userId) // Remove user details too
    await this.saveToStorage()
    this.notifyListeners()
    
    console.log('✅ [BLOCK] User unblocked:', { userId, total: this.blockedUsers.size })
    return true
  }

  async isBlocked(userId) {
    await this.initialize()
    return this.blockedUsers.has(userId)
  }

  async getBlockedUsers() {
    await this.initialize()
    return Array.from(this.blockedUsers)
  }

  async getBlockedUsersWithDetails() {
    await this.initialize()
    const blockedUsersWithDetails = []
    
    for (const userId of this.blockedUsers) {
      const details = this.blockedUsersDetails.get(userId)
      if (details) {
        blockedUsersWithDetails.push(details)
      } else {
        // Fallback for users blocked before details were stored
        blockedUsersWithDetails.push({
          id: userId,
          pseudo: `Utilisateur ${userId}`,
          age: null,
          sexe: null,
          isPlaceholder: true
        })
      }
    }
    
    return blockedUsersWithDetails
  }

  async getBlockedUsersCount() {
    await this.initialize()
    return this.blockedUsers.size
  }

  async clearAllBlocked() {
    this.blockedUsers.clear()
    this.blockedUsersDetails.clear()
    await this.saveToStorage()
    this.notifyListeners()
    console.log('🗑️ [BLOCK] All users unblocked')
  }

  // Filter functions for conversations and messages
  filterConversations(conversations) {
    if (!conversations || !Array.isArray(conversations)) return conversations
    if (!this.initialized) return conversations // Return unfiltered if not initialized yet
    
    return conversations.filter(conversation => {
      const otherUserId = conversation.receiver_id === conversation.current_user_id 
        ? conversation.sender_id 
        : conversation.receiver_id
      
      const isBlocked = this.blockedUsers.has(String(otherUserId))
      if (isBlocked) {
        console.log('📵 [BLOCK] Filtering blocked conversation:', { otherUserId, pseudo: conversation.otherUser?.pseudo })
      }
      return !isBlocked
    })
  }

  filterMessages(messages) {
    if (!messages || !Array.isArray(messages)) return messages
    if (!this.initialized) return messages // Return unfiltered if not initialized yet
    
    return messages.filter(message => {
      const isBlocked = this.blockedUsers.has(String(message.sender_id))
      if (isBlocked) {
        console.log('📵 [BLOCK] Filtering blocked message:', { senderId: message.sender_id })
      }
      return !isBlocked
    })
  }

  filterSearchResults(users) {
    if (!users || !Array.isArray(users)) return users
    if (!this.initialized) return users // Return unfiltered if not initialized yet
    
    return users.map(user => ({
      ...user,
      isBlocked: this.blockedUsers.has(String(user.id))
    }))
  }

  // Check if notification should be blocked
  async shouldBlockNotification(senderId) {
    await this.initialize()
    const isBlocked = this.blockedUsers.has(String(senderId))
    if (isBlocked) {
      console.log('📵 [BLOCK] Notification blocked for user:', senderId)
    }
    return isBlocked
  }

  // Listener management for real-time updates
  addListener(callback) {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  notifyListeners() {
    this.listeners.forEach(callback => {
      try {
        callback(Array.from(this.blockedUsers))
      } catch (error) {
        console.error('❌ [BLOCK] Listener error:', error)
      }
    })
  }

  async saveToStorage() {
    try {
      // Save blocked user IDs
      const blockedList = Array.from(this.blockedUsers)
      const blockedListJson = JSON.stringify(blockedList)
      console.log('📵 [BLOCK] Preparing to save IDs:', {
        setSize: this.blockedUsers.size,
        arrayLength: blockedList.length,
        array: blockedList,
        json: blockedListJson
      })
      
      await AsyncStorage.setItem(BLOCKED_USERS_KEY, blockedListJson)
      console.log('📵 [BLOCK] Saved IDs to AsyncStorage successfully')
      
      // Verify the save
      const verification = await AsyncStorage.getItem(BLOCKED_USERS_KEY)
      console.log('📵 [BLOCK] Verification read:', verification)
      
      // Save blocked user details
      const detailsObject = Object.fromEntries(this.blockedUsersDetails)
      const detailsJson = JSON.stringify(detailsObject)
      console.log('📵 [BLOCK] Preparing to save details:', {
        mapSize: this.blockedUsersDetails.size,
        objectKeys: Object.keys(detailsObject),
        json: detailsJson
      })
      
      await AsyncStorage.setItem(BLOCKED_USERS_DETAILS_KEY, detailsJson)
      console.log('📵 [BLOCK] Saved details to AsyncStorage successfully')
      
      console.log('📵 [BLOCK] Complete save operation finished for', blockedList.length, 'users')
    } catch (error) {
      console.error('❌ [BLOCK] Failed to save to storage:', error)
    }
  }
}

// Export singleton instance
export const blockService = new BlockService()
export default blockService
