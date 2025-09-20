// data/stores/chatStore.js
// Simple in-memory store for chat messages per conversation used for optimistic UI updates
export const chatStore = (() => {
  const state = {
    byConversation: {},
    markMessageIdsAsSeen(ids, seenAt) {
      const seenSet = new Set(ids || []);
      Object.values(state.byConversation).forEach(list => {
        list.forEach(m => {
          if (seenSet.has(m.id)) { m.seen = true; m.seen_at = seenAt ?? new Date().toISOString(); }
        });
      });
    },
    markUntilTimestampAsSeen({ conversationId, receiverId, beforeISO }) {
      const list = state.byConversation[conversationId];
      if (!list) return;
      const cutoff = Date.parse(beforeISO);
      list.forEach(m => {
        if (m.receiver_id === receiverId && Date.parse(m.created_at) <= cutoff) {
          m.seen = true; m.seen_at = new Date().toISOString();
        }
      });
    }
  };
  
  // Pair-based helpers for apps that don't use conversation_id
  state.markMessageIdsAsSeenPair = function(ids, receiverId, senderId, seenAt) {
    const idSet = new Set(ids || []);
    Object.entries(state.byConversation).forEach(([convKey, list]) => {
      list.forEach(m => {
        const matchesPair = (m.receiver_id === receiverId && m.sender_id === senderId) || (m.receiver_id === senderId && m.sender_id === receiverId);
        if (matchesPair && idSet.has(m.id)) { m.seen = true; m.seen_at = seenAt ?? new Date().toISOString(); }
      });
    });
  }

  state.markUntilTimestampAsSeenPair = function({ receiverId, senderId, beforeISO }) {
    const cutoff = Date.parse(beforeISO);
    Object.values(state.byConversation).forEach(list => {
      list.forEach(m => {
        if (m.receiver_id === receiverId && m.sender_id === senderId && Date.parse(m.created_at) <= cutoff) {
          m.seen = true; m.seen_at = new Date().toISOString();
        }
      });
    });
  }
  return state;
})();
