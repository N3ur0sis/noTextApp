// data/messagesCache.js
// Lightweight messages cache utilities for optimistic read updates
import AsyncStorage from '@react-native-async-storage/async-storage'

export const messagesCache = {
  // Mark specific message ids as seen inside any stored message arrays
  async setSeenFor(conversationId, ids, seenAt) {
    const idSet = new Set(ids || []);
    try {
      const keys = await AsyncStorage.getAllKeys();
      await Promise.all(keys.map(async k => {
        if (!k.includes(`conversationId:${conversationId}`) && !k.startsWith('messages_')) return;
        try {
          const raw = await AsyncStorage.getItem(k);
          if (!raw) return;
          const arr = JSON.parse(raw || '[]');
          let changed = false;
          for (const m of arr) {
            if (idSet.has(m.id)) { m.seen = true; m.seen_at = seenAt ?? new Date().toISOString(); changed = true; }
          }
          if (changed) await AsyncStorage.setItem(k, JSON.stringify(arr));
        } catch (e) {}
      }));
    } catch (e) { console.warn('messagesCache.setSeenFor error', e) }
  },

  async markUntilTimestampAsSeen(conversationId, receiverId, beforeISO) {
    const cutoff = Date.parse(beforeISO);
    try {
      const keys = await AsyncStorage.getAllKeys();
      await Promise.all(keys.map(async k => {
        if (!k.includes(`conversationId:${conversationId}`) && !k.startsWith('messages_')) return;
        try {
          const raw = await AsyncStorage.getItem(k);
          if (!raw) return;
          const arr = JSON.parse(raw || '[]');
          let changed = false;
          for (const m of arr) {
            if (m.receiver_id === receiverId && Date.parse(m.created_at) <= cutoff) {
              if (!m.seen) { m.seen = true; m.seen_at = new Date().toISOString(); changed = true; }
            }
          }
          if (changed) await AsyncStorage.setItem(k, JSON.stringify(arr));
        } catch (e) {}
      }));
    } catch (e) { console.warn('messagesCache.markUntilTimestampAsSeen error', e) }
  }
  ,
  // Pair-based helpers
  async setSeenForPair(currentId, otherId, ids, seenAt) {
    const idSet = new Set(ids || []);
    try {
      const keys = await AsyncStorage.getAllKeys();
      await Promise.all(keys.map(async k => {
        if (!k.startsWith('messages_')) return;
        try {
          const raw = await AsyncStorage.getItem(k);
          if (!raw) return;
          const arr = JSON.parse(raw || '[]');
          let changed = false;
          for (const m of arr) {
            const matchesPair = (m.receiver_id === currentId && m.sender_id === otherId) || (m.receiver_id === otherId && m.sender_id === currentId);
            if (matchesPair && idSet.has(m.id)) { m.seen = true; m.seen_at = seenAt ?? new Date().toISOString(); changed = true; }
          }
          if (changed) await AsyncStorage.setItem(k, JSON.stringify(arr));
        } catch (e) {}
      }));
    } catch (e) { console.warn('messagesCache.setSeenForPair error', e) }
  },

  async markUntilTimestampAsSeenPair(currentId, otherId, beforeISO) {
    const cutoff = Date.parse(beforeISO);
    try {
      const keys = await AsyncStorage.getAllKeys();
      await Promise.all(keys.map(async k => {
        if (!k.startsWith('messages_')) return;
        try {
          const raw = await AsyncStorage.getItem(k);
          if (!raw) return;
          const arr = JSON.parse(raw || '[]');
          let changed = false;
          for (const m of arr) {
            const matchesPair = (m.receiver_id === currentId && m.sender_id === otherId) || (m.receiver_id === otherId && m.sender_id === currentId);
            if (matchesPair && Date.parse(m.created_at) <= cutoff) {
              if (!m.seen) { m.seen = true; m.seen_at = new Date().toISOString(); changed = true; }
            }
          }
          if (changed) await AsyncStorage.setItem(k, JSON.stringify(arr));
        } catch (e) {}
      }));
    } catch (e) { console.warn('messagesCache.markUntilTimestampAsSeenPair error', e) }
  },

  // Add method to update read status for individual messages
  async updateMessageReadStatus(messageId, senderId, receiverId, seenAt, isNsfw) {
    try {
      const keys = await AsyncStorage.getAllKeys();
      await Promise.all(keys.map(async k => {
        if (!k.startsWith('messages_')) return;
        try {
          const raw = await AsyncStorage.getItem(k);
          if (!raw) return;
          const arr = JSON.parse(raw || '[]');
          let changed = false;
          for (const m of arr) {
            if (m.id === messageId) {
              m.seen = true;
              m.seen_at = seenAt || new Date().toISOString();
              changed = true;
              break;
            }
          }
          if (changed) await AsyncStorage.setItem(k, JSON.stringify(arr));
        } catch (e) {}
      }));
    } catch (e) { console.warn('messagesCache.updateMessageReadStatus error', e) }
  }
};
