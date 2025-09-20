/**
 * BATCH MEDIA LOADING - Usage Examples
 * Implement these patterns in your screens to maximize egress savings
 */

import { useEffect } from 'react';
import { getSignedUrlsBatch } from '../services/unifiedMediaService';

// Global preload deduplication to prevent multiple screens from batch signing the same URLs
const globalPreloadCache = new Set() // Track URLs that are being or have been preloaded
const PRELOAD_CACHE_TTL = 30000 // 30 seconds TTL for preload cache

// ========================================
// EXAMPLE 1: ChatScreen Media Pre-loading
// ========================================
export const useChatMediaPreloader = (messages) => {
  useEffect(() => {
    if (!messages || messages.length === 0) return;
    
    // Collect all media URLs from visible messages (BOTH media and thumbnails)
    // IMPORTANT: Skip NSFW content from automatic preloading to prevent unwanted background processing
    const allMediaUrls = [];
    
    messages.forEach(message => {
      // Skip NSFW messages from automatic preloading
      if (message.is_nsfw) {
        if (__DEV__) console.log(`🔒 [CHAT_PRELOAD] Skipping NSFW message from preload: ${message.id}`);
        return;
      }
      
      if (message.media_url) {
        allMediaUrls.push(message.media_url);
      }
      if (message.thumbnail_url) {
        allMediaUrls.push(message.thumbnail_url);
      }
    });
    
    if (allMediaUrls.length === 0) return;
    
    // CRITICAL FIX: Deduplicate against global preload cache to prevent redundant batch requests
    const urlsToPreload = allMediaUrls.filter(url => !globalPreloadCache.has(url));
    
    if (urlsToPreload.length === 0) {
      console.log(`📦 [CHAT_PRELOAD] All ${allMediaUrls.length} URLs already preloaded, skipping`);
      return;
    }
    
    // Mark URLs as being preloaded
    urlsToPreload.forEach(url => globalPreloadCache.add(url));
    
    // Clean up expired entries after TTL
    setTimeout(() => {
      urlsToPreload.forEach(url => globalPreloadCache.delete(url));
    }, PRELOAD_CACHE_TTL);
    
    // Batch sign all media in one request
    const preloadMedia = async () => {
      try {
        console.log(`📦 [CHAT_PRELOAD] Batch signing ${urlsToPreload.length} new media items (${allMediaUrls.length - urlsToPreload.length} already cached)`);
        const signedUrls = await getSignedUrlsBatch(urlsToPreload);
        console.log(`✅ [CHAT_PRELOAD] Successfully pre-signed ${signedUrls.size} URLs`);
        
        // URLs are now cached and ready for immediate use by CachedImage/CachedVideo components
      } catch (error) {
        console.error('❌ [CHAT_PRELOAD] Batch signing failed:', error);
        // Remove from global cache on failure so they can be retried
        urlsToPreload.forEach(url => globalPreloadCache.delete(url));
      }
    };
    
    // Small delay to avoid interfering with initial message load
    const timeoutId = setTimeout(preloadMedia, 100);
    return () => clearTimeout(timeoutId);
    
  }, [messages]);
};

// ========================================
// EXAMPLE 2: HomeScreen Conversation Previews
// ========================================
export const useConversationMediaPreloader = (conversations) => {
  useEffect(() => {
    if (!conversations || conversations.length === 0) return;
    
    // Collect media URLs from last messages in conversations (BOTH media and thumbnails)
    const allPreviewUrls = [];
    
    conversations.forEach(conversation => {
      const lastMessage = conversation.last_message;
      if (lastMessage?.media_url) {
        allPreviewUrls.push(lastMessage.media_url);
      }
      if (lastMessage?.thumbnail_url) {
        allPreviewUrls.push(lastMessage.thumbnail_url);
      }
      
      // Also check latestMediaUrl and latestThumbnailUrl for conversation previews
      if (conversation.latestMediaUrl) {
        allPreviewUrls.push(conversation.latestMediaUrl);
      }
      if (conversation.latestThumbnailUrl) {
        allPreviewUrls.push(conversation.latestThumbnailUrl);
      }
    });
    
    // Remove duplicates
    const uniqueUrls = [...new Set(allPreviewUrls.filter(Boolean))];
    
    if (uniqueUrls.length === 0) return;
    
    // CRITICAL FIX: Deduplicate against global preload cache
    const urlsToPreload = uniqueUrls.filter(url => !globalPreloadCache.has(url));
    
    if (urlsToPreload.length === 0) {
      console.log(`📦 [HOME_PRELOAD] All ${uniqueUrls.length} preview URLs already preloaded, skipping`);
      return;
    }
    
    // Mark URLs as being preloaded  
    urlsToPreload.forEach(url => globalPreloadCache.add(url));
    
    // Clean up expired entries after TTL
    setTimeout(() => {
      urlsToPreload.forEach(url => globalPreloadCache.delete(url));
    }, PRELOAD_CACHE_TTL);
    
    const preloadPreviews = async () => {
      try {
        console.log(`📦 [HOME_PRELOAD] Batch signing ${urlsToPreload.length} new preview media (${uniqueUrls.length - urlsToPreload.length} already cached)`);
        await getSignedUrlsBatch(urlsToPreload);
        console.log(`✅ [HOME_PRELOAD] Previews pre-signed and cached`);
      } catch (error) {
        console.error('❌ [HOME_PRELOAD] Preview batch signing failed:', error);
        // Remove from global cache on failure so they can be retried
        urlsToPreload.forEach(url => globalPreloadCache.delete(url));
      }
    };
    
    preloadPreviews();
    
  }, [conversations]);
};

// ========================================
// EXAMPLE 3: Smart Preloader Hook
// ========================================
export const useSmartMediaPreloader = (mediaItems, options = {}) => {
  const { 
    maxItems = 10,        // Limit batch size
    delay = 100,          // Delay before preloading  
    priority = 'normal'   // Could be used for different strategies
  } = options;
  
  useEffect(() => {
    if (!mediaItems || mediaItems.length === 0) return;
    
    // Take only the first maxItems to avoid huge batches
    const urlsToPreload = mediaItems
      .slice(0, maxItems)
      .filter(item => item && (typeof item === 'string' || item.url))
      .map(item => typeof item === 'string' ? item : item.url);
    
    if (urlsToPreload.length === 0) return;
    
    const preload = async () => {
      try {
        console.log(`📦 [SMART_PRELOAD] Batch signing ${urlsToPreload.length} items (${priority} priority)`);
        const startTime = Date.now();
        
        await getSignedUrlsBatch(urlsToPreload); // P5 FIX: Correct function name
        
        const duration = Date.now() - startTime;
        console.log(`✅ [SMART_PRELOAD] Completed in ${duration}ms`);
      } catch (error) {
        console.error('❌ [SMART_PRELOAD] Failed:', error);
      }
    };
    
    const timeoutId = setTimeout(preload, delay);
    return () => clearTimeout(timeoutId);
    
  }, [mediaItems, maxItems, delay, priority]);
};

// ========================================
// IMPLEMENTATION GUIDE
// ========================================

/*
ADD TO ChatScreen.js:
```javascript
import { useChatMediaPreloader } from '../utils/mediaPreloaders';

// In your ChatScreen component:
const ChatScreen = () => {
  // ... existing code ...
  
  // Add this line to preload all visible media
  useChatMediaPreloader(messages);
  
  // ... rest of component
}
```

ADD TO HomeScreen.js:
```javascript
import { useConversationMediaPreloader } from '../utils/mediaPreloaders';

// In your HomeScreen component:
const HomeScreen = () => {
  // ... existing code ...
  
  // Add this line to preload conversation preview media
  useConversationMediaPreloader(conversations);
  
  // ... rest of component
}
```

PERFORMANCE BENEFITS:
- Instead of 5-10 individual sign requests per screen load
- You get 1 batch request for all media
- 80%+ reduction in storage API calls
- Faster media loading (pre-signed URLs cached)
- Better user experience (no loading delays)

MONITORING:
Watch your Supabase logs for:
- Fewer /storage/v1/object/sign requests
- Single batch requests instead of individual calls
- Reduced overall egress on storage operations
*/

export default {
  useChatMediaPreloader,
  useConversationMediaPreloader,
  useSmartMediaPreloader
};
