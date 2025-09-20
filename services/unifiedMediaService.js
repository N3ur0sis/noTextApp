/**
 * UNIFIED MEDIA SERVICE - Production Ready
 * Single source of truth for all media operations
 * Consolidates all previous media services into one streamlined system
 */

import { decode } from 'base64-arraybuffer'
import * as FileSystem from 'expo-file-system'
import * as VideoThumbnails from 'expo-video-thumbnails'
import { supabase } from './supabaseClient'

// Unified cache directories
const CACHE_DIRECTORIES = {
  images: `${FileSystem.cacheDirectory}images/`,
  videos: `${FileSystem.cacheDirectory}videos/`,
  thumbnails: `${FileSystem.cacheDirectory}thumbnails/`
}

// --- NEW: helpers for local cache paths & signed URLs --- //
const SB_SCHEME_MEDIA = 'sb://media/';
const SB_SCHEME_THUMBS = 'sb://thumbs/';

// Index local des fichiers que le sender possède déjà (évite tout re-download)
const senderLocalIndex = {
  media: new Map(),     // objectKey -> local file path
  thumbs: new Map(),    // objectKey -> local file path (optionnel)
};

// Crée récursivement les dossiers pour un chemin fichier donné
async function ensureSubdirsForFile(fullPath) {
  const parts = fullPath.split('/');
  parts.pop(); // remove filename
  const dir = parts.join('/') + '/';
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
}

// Extrait l'objectKey d'une URL signée Supabase
function extractObjectKeyFromSignedUrl(url) {
  try {
    // ex: .../object/sign/media/<objectKey>?token=...
    const m = url.match(/\/object\/sign\/media\/([^?]+)\?/);
    if (m && m[1]) return decodeURIComponent(m[1]);
    // fallback: .../media/<objectKey> sans /object/sign
    const n = url.match(/\/media\/([^?]+)(?:\?|$)/);
    if (n && n[1]) return decodeURIComponent(n[1]);
  } catch {}
  return null;
}

// Options de transformation pour thumbnails (côté Supabase)
function thumbTransformOptions() {
  return { width: 512, quality: 70 };
}

// PATCH 5: Long TTL and persistent cache for storage signing
const SIGN_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours (much longer than 5 minutes)
const signCache = new Map()       // key -> { url, exp }
const signInFlight = new Map()    // key -> Promise<string>
// Global download deduplication - shared across all instances and methods
const globalDownloadQueue = new Map() // objectKey -> Promise
const batchSignInFlight = new Map() // CRITICAL FIX: Prevent duplicate batch requests
const signKey = (objectKey, isThumb) => `${objectKey}::${isThumb ? 'thumb' : 'orig'}`

// Unified media service class
class UnifiedMediaService {
  constructor() {
    this.cache = new Map() // Unified cache for signed URLs
    this.fileCache = new Map() // File path cache
    this.downloadQueue = new Map() // Prevent duplicate downloads
    this.processingUrls = new Set() // Track processing status
    this.initialized = false
    
    this.init()
  }

  async init() {
    if (this.initialized) return
    
    try {
      // Create cache directories
      for (const [type, dir] of Object.entries(CACHE_DIRECTORIES)) {
        const dirInfo = await FileSystem.getInfoAsync(dir)
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(dir, { intermediates: true })
          if (__DEV__) console.log(`📁 [UNIFIED_MEDIA] Created ${type} cache directory`)
        }
      }
      
      this.initialized = true
      if (__DEV__) console.log('✅ [UNIFIED_MEDIA] Service initialized')
    } catch (error) {
      console.error('❌ [UNIFIED_MEDIA] Initialization failed:', error)
    }
  }

  // Normalize URL for consistent caching
  normalizeUrl(url) {
    if (!url) return url
    try {
      const urlObj = new URL(url)
      urlObj.searchParams.delete('token')
      return urlObj.toString()
    } catch {
      return url.split('?token=')[0]
    }
  }

  // Get cache key from URL
  getCacheKey(url) {
    if (!url) return null
    
    if (__DEV__) console.log(`🔑 [CACHE_KEY] Input URL: ${url}`)
    
    // Handle our internal sb:// schemes - preserve the bucket distinction
    if (url.startsWith('sb://media/')) {
      const result = url.slice('sb://'.length) // Keep "media/" prefix
      if (__DEV__) console.log(`🔑 [CACHE_KEY] sb://media/ URL, extracted: ${result}`)
      return result
    }
    if (url.startsWith('sb://thumbs/')) {
      const result = url.slice('sb://'.length) // Keep "thumbs/" prefix
      if (__DEV__) console.log(`🔑 [CACHE_KEY] sb://thumbs/ URL, extracted: ${result}`)
      return result
    }
    
    // Handle regular signed URLs
    const normalized = this.normalizeUrl(url)
    const result = normalized.split('/media/')[1]?.split('?')[0] || null
    if (__DEV__) console.log(`🔑 [CACHE_KEY] Regular URL, normalized: ${normalized}, result: ${result}`)
    return result
  }

  // Get signed URL with caching
  async getSignedUrl(publicUrl) {
    if (!publicUrl) return null

    const cacheKey = this.getCacheKey(publicUrl)
    if (!cacheKey) return publicUrl

    // Check cache first - PATCH 5: Use longer TTL
    const cached = this.cache.get(cacheKey)
    if (cached && (Date.now() - cached.timestamp) < SIGN_TTL_MS) { // 24 hours
      return cached.url
    }

    try {
      // EGRESS OPTIMIZATION: Try batch signing first to avoid individual API calls
      try {
        const batchResults = await this.getSignedUrlsBatch([publicUrl]);
        const batchUrl = batchResults.get(publicUrl);
        
        if (batchUrl && batchUrl !== publicUrl) { // If batch signing succeeded
          if (__DEV__) console.log(`✅ [UNIFIED_MEDIA] Got ${publicUrl} via batch signing`)
          return batchUrl;
        }
      } catch (batchError) {
        if (__DEV__) console.log(`⚠️ [UNIFIED_MEDIA] Batch signing failed for ${publicUrl}, using individual fallback`)
      }

      // Both media and thumbs use the media bucket - thumbs don't exist as separate files
      let bucket = 'media'
      let path = cacheKey
      
      if (cacheKey.startsWith('media/')) {
        path = cacheKey.slice('media/'.length)
      } else if (cacheKey.startsWith('thumbs/')) {
        // Thumbnails are handled through media bucket with same path
        path = cacheKey.slice('thumbs/'.length)
      }
      
      // Individual fallback should rarely be used now
      if (__DEV__) console.log(`🔄 [UNIFIED_MEDIA] Using individual signing fallback for ${path}`)
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 86400) // 24 hours
      
      if (error) throw error

      // Cache the result with multiple key formats
      const cacheEntry = {
        url: data.signedUrl,
        timestamp: Date.now()
      }
      
      this.cache.set(cacheKey, cacheEntry) // Original format
      
      // Also store with short key format for getSignedUrlOnce compatibility
      const pathParts = cacheKey.split('/')
      if (pathParts.length >= 2) {
        const shortKey = pathParts.slice(-2).join('/')
        this.cache.set(shortKey, cacheEntry)
      }

      return data.signedUrl
    } catch (error) {
      console.error('❌ [UNIFIED_MEDIA] Failed to get signed URL:', error)
      return publicUrl // Fallback
    }
  }

  // Get signed URLs in batch  
  async getSignedUrlsBatch(urls) {
    if (!Array.isArray(urls) || urls.length === 0) return new Map()

    if (__DEV__) console.log(`🔍 [BATCH_DEBUG] Input URLs:`, urls.slice(0, 3))

    // EGRESS OPTIMIZATION: Deduplicate input URLs to prevent redundant processing
    const uniqueUrls = [...new Set(urls)]
    if (uniqueUrls.length !== urls.length) {
      if (__DEV__) console.log(`🚀 [BATCH_OPT] Deduplicated ${urls.length} -> ${uniqueUrls.length} URLs`)
    }

    // CRITICAL FIX: Create batch key from sorted unique URLs to prevent duplicate batch requests
    const batchKey = uniqueUrls.sort().join('|')
    
    // Check if this exact batch is already being processed
    if (batchSignInFlight.has(batchKey)) {
      if (__DEV__) console.log(`⏳ [BATCH_DEBUG] Batch request already in flight, waiting...`)
      return await batchSignInFlight.get(batchKey)
    }

    const results = new Map()
    const uncachedUrls = []

    // Check cache first - PATCH 5: Use longer TTL
    for (const url of uniqueUrls) {
      const cacheKey = this.getCacheKey(url)
      if (__DEV__) console.log(`🔍 [BATCH_DEBUG] URL: ${url} -> CacheKey: ${cacheKey}`)
      
      if (!cacheKey) {
        if (__DEV__) console.log(`❌ [BATCH_DEBUG] No cache key for: ${url}`)
        results.set(url, url)
        continue
      }

      const cached = this.cache.get(cacheKey)
      if (cached && (Date.now() - cached.timestamp) < SIGN_TTL_MS) { // 24 hours
        if (__DEV__) console.log(`🎯 [BATCH_DEBUG] Cache hit for: ${cacheKey}`)
        results.set(url, cached.url)
      } else {
        if (__DEV__) console.log(`❌ [BATCH_DEBUG] Cache miss for: ${cacheKey}`)
        uncachedUrls.push({ url, cacheKey })
      }
    }

    if (__DEV__) console.log(`🔍 [BATCH_DEBUG] Uncached URLs: ${uncachedUrls.length}`)

    // PATCH 5: Batch fetch uncached URLs with 24h TTL
    if (uncachedUrls.length > 0) {
      // CRITICAL FIX: Store batch promise to prevent duplicates
      const batchPromise = (async () => {
        try {
          // Group URLs - both media and thumbs will be signed through media bucket
          const mediaUrls = []
          
          uncachedUrls.forEach(({ url, cacheKey }) => {
            if (cacheKey.startsWith('media/')) {
              mediaUrls.push({ url, cacheKey, path: cacheKey.slice('media/'.length) })
            } else if (cacheKey.startsWith('thumbs/')) {
              // Thumbnails don't exist as separate files - transform to use media bucket with the same path
              const thumbnailPath = cacheKey.slice('thumbs/'.length)
              mediaUrls.push({ url, cacheKey, path: thumbnailPath, isThumb: true })
            }
          })
          
          if (__DEV__) console.log(`🚀 [BATCH_DEBUG] Total URLs to sign: ${mediaUrls.length}`)
          
          // Sign all URLs through media bucket
          if (mediaUrls.length > 0) {
            const mediaPaths = mediaUrls.map(({ path }) => path)
            if (__DEV__) console.log(`🚀 [BATCH_DEBUG] Batch signing paths:`, mediaPaths)
            
            const { data: mediaData, error: mediaError } = await supabase.storage.from('media').createSignedUrls(mediaPaths, 86400)
            
            if (mediaError) throw mediaError
            
            if (__DEV__) console.log(`✅ [BATCH_DEBUG] Batch response:`, mediaData ? `${mediaData.length} results` : 'null')
            if (__DEV__) console.log(`🔍 [BATCH_DEBUG] Full batch response:`, mediaData)
            
            mediaUrls.forEach(({ url, cacheKey, isThumb }, index) => {
              const signedData = mediaData[index]
              if (__DEV__) console.log(`🔍 [BATCH_DEBUG] Processing ${url} at index ${index}:`, signedData)
              
              if (signedData && signedData.signedUrl) {
                const cacheEntry = {
                  url: signedData.signedUrl,
                  timestamp: Date.now()
                }
                
                // CRITICAL FIX: Store with ALL possible key formats to prevent individual signing
                const pathWithoutPrefix = cacheKey.replace(/^(media|thumbs)\//, '')
                const allCacheKeys = [
                  cacheKey,                    // Original format (e.g., "media/test1/test2/1756109915321.jpg")
                  pathWithoutPrefix,           // Without prefix (e.g., "test1/test2/1756109915321.jpg")
                  `media/${pathWithoutPrefix}`, // Media prefixed
                  `thumbs/${pathWithoutPrefix}`, // Thumbs prefixed
                  `sb://media/${pathWithoutPrefix}` // Full sb:// format
                ]
                
                // Store in cache with all possible key formats
                allCacheKeys.forEach(key => {
                  this.cache.set(key, cacheEntry)
                })
                
                // Also store in the global signCache for getSignedUrlOnce compatibility
                const signCacheKey = signKey(pathWithoutPrefix, isThumb)
                signCache.set(signCacheKey, { url: signedData.signedUrl, exp: Date.now() + SIGN_TTL_MS })
                
                results.set(url, signedData.signedUrl)
                const urlType = isThumb ? 'thumbnail' : 'media'
                if (__DEV__) console.log(`✅ [BATCH_DEBUG] ${urlType} signed & cached with ${allCacheKeys.length} keys: ${url} -> ${signedData.signedUrl.slice(0, 50)}...`)
              } else {
                if (__DEV__) console.log(`❌ [BATCH_DEBUG] No signed URL for: ${url}`)
                results.set(url, url)
              }
            })
          }
        } catch (error) {
          // Network errors during batch signing are non-critical - the app continues to function
          if (__DEV__) console.warn('⚠️ [UNIFIED_MEDIA] Batch signing temporarily unavailable (non-critical):', error.message || error)
          
          // EGRESS OPTIMIZATION: Do NOT fallback to individual calls - this causes the API spam
          // Instead, return original URLs and let the component handle the failure gracefully
          uncachedUrls.forEach(({ url }) => {
            results.set(url, url) // Return original URL as fallback
          })
        }
        
        return results
      })()
      
      // Store the batch promise to prevent duplicates
      batchSignInFlight.set(batchKey, batchPromise)
      
      try {
        await batchPromise
      } finally {
        // Clean up the in-flight map
        batchSignInFlight.delete(batchKey)
      }
    }

    // EGRESS OPTIMIZATION: Populate results for all original URLs, including duplicates
    const finalResults = new Map()
    for (const originalUrl of urls) {
      if (results.has(originalUrl)) {
        finalResults.set(originalUrl, results.get(originalUrl))
      } else {
        finalResults.set(originalUrl, originalUrl) // Fallback
      }
    }

    return finalResults
  }

  async getSignedUrlOnce(objectKey, isThumb = false) {
    const k = signKey(objectKey, isThumb)
    const now = Date.now()

    // CRITICAL FIX: Always check unified cache first with ALL possible key formats
    const possibleCacheKeys = [
      objectKey, // Direct objectKey format
      `media/${objectKey}`, // media/ prefixed format
      `thumbs/${objectKey}`, // thumbs/ prefixed format
      objectKey.replace(/^(media|thumbs)\//, ''), // Remove prefix if present
      `sb://media/${objectKey}`, // Full path format
      this.getCacheKey(`sb://media/${objectKey}`) // Normalized key format
    ].filter(Boolean)

    // Try all possible cache key formats to prevent cache misses
    for (const cacheKey of possibleCacheKeys) {
      const batchCached = this.cache.get(cacheKey)
      if (batchCached && (now - batchCached.timestamp) < SIGN_TTL_MS) {
        if (__DEV__) console.log(`🎯 [UNIFIED_MEDIA] Using cached URL for ${objectKey} (key: ${cacheKey})`)
        return batchCached.url
      }
    }
    
    if (__DEV__) {
      console.log(`⚠️ [UNIFIED_MEDIA] Cache miss for ${objectKey}, checked keys:`, possibleCacheKeys)
      console.log(`🔍 [UNIFIED_MEDIA] Cache has ${this.cache.size} entries. Sample keys: ${Array.from(this.cache.keys()).slice(0, 5).join(', ')}`)
    }

    // For thumbnails, also check if we have a cached regular version we can transform
    // This reduces individual storage API calls for thumbnails
    if (isThumb) {
      // Try both cache key formats for thumbnail optimization
      let batchCached = this.cache.get(objectKey) // Direct objectKey format
      if (!batchCached) {
        // Also try the full path format used by getCacheKey
        const fullPath = objectKey.startsWith('sb://media/') ? objectKey : `sb://media/${objectKey}`
        const normalizedKey = this.getCacheKey(fullPath)
        if (normalizedKey) {
          batchCached = this.cache.get(normalizedKey)
        }
      }
      
      // If we have the original image cached, we still need to create a thumbnail-specific signed URL
      // But we can log when we're benefiting from batch cache warmup
      if (batchCached && (now - batchCached.timestamp) < SIGN_TTL_MS) {
        if (__DEV__) console.log(`🎯 [UNIFIED_MEDIA] Original image cached, creating thumbnail for ${objectKey}`)
      }
    }

    const cached = signCache.get(k)
    if (cached && cached.exp > now) {
      if (__DEV__) console.log(`🎯 [UNIFIED_MEDIA] Using signCache for ${objectKey}`)
      return cached.url
    }

    if (signInFlight.has(k)) {
      if (__DEV__) console.log(`⏳ [UNIFIED_MEDIA] Request in flight for ${objectKey}`)
      return await signInFlight.get(k)
    }

    if (__DEV__) console.log(`🚀 [UNIFIED_MEDIA] Cache miss for ${objectKey} (thumb: ${isThumb}) - trying batch signing first`)

    const p = (async () => {
      // EGRESS OPTIMIZATION: Try batch signing first to avoid individual API calls
      try {
        const sbUrl = isThumb ? `sb://thumbs/${objectKey}` : `sb://media/${objectKey}`;
        const batchResults = await this.getSignedUrlsBatch([sbUrl]);
        const batchUrl = batchResults.get(sbUrl);
        
        if (batchUrl && batchUrl !== sbUrl) { // If batch signing succeeded (didn't return original URL)
          if (__DEV__) console.log(`✅ [UNIFIED_MEDIA] Got ${objectKey} via batch signing`)
          return batchUrl;
        }
      } catch (error) {
        if (__DEV__) console.log(`⚠️ [UNIFIED_MEDIA] Batch signing failed for ${objectKey}, using fallback`)
      }
      
      // Fallback: return the sb:// URL as-is (let the component handle it)
      if (__DEV__) console.log(`🔄 [UNIFIED_MEDIA] Returning fallback URL for ${objectKey}`)
      const fallbackUrl = isThumb ? `sb://thumbs/${objectKey}` : `sb://media/${objectKey}`;
      return fallbackUrl;
    })()

    signInFlight.set(k, p)
    try {
      const url = await p
      signCache.set(k, { url, exp: now + SIGN_TTL_MS })
      return url
    } finally {
      signInFlight.delete(k)
    }
  }

  // Télécharge (une seule fois) un objectKey vers le cache local, puis renvoie file://...
  async getLocalPathFromObjectKey(objectKey, type = 'image', priority = 'normal') {
    // 1) Le sender a peut-être déjà le fichier local -> réutiliser
    if (type === 'image' && senderLocalIndex.media.has(objectKey)) {
      const local = senderLocalIndex.media.get(objectKey);
      const info = await FileSystem.getInfoAsync(local);
      if (info.exists) {
        if (__DEV__ && priority === 'notification') {
          console.log(`🎯 [UNIFIED_MEDIA] Using sender local cache for ${objectKey}`);
        }
        return local;
      }
    }
    if (type === 'thumbnail' && senderLocalIndex.thumbs.has(objectKey)) {
      const local = senderLocalIndex.thumbs.get(objectKey);
      const info = await FileSystem.getInfoAsync(local);
      if (info.exists) {
        if (__DEV__ && priority === 'notification') {
          console.log(`🎯 [UNIFIED_MEDIA] Using sender local thumbnail cache for ${objectKey}`);
        }
        return local;
      }
    }

    // 2) Chemin cache local ciblé (on garde la hiérarchie)
    const baseDir = type === 'thumbnail' ? CACHE_DIRECTORIES.thumbnails : CACHE_DIRECTORIES.images;
    const localPath = `${baseDir}${objectKey}`;
    const already = await FileSystem.getInfoAsync(localPath);
    if (already.exists) {
      if (__DEV__ && priority === 'notification') {
        console.log(`🎯 [UNIFIED_MEDIA] File already cached locally for ${objectKey}`);
      }
      return localPath;
    }

    await ensureSubdirsForFile(localPath);

    // 3) EGRESS OPTIMIZATION: Try to use batch cache first before individual signing
    let signed = null;
    const cacheKey = type === 'thumbnail' ? `thumbs/${objectKey}` : `media/${objectKey}`;
    const batchCached = this.cache.get(cacheKey);
    
    if (batchCached && (Date.now() - batchCached.timestamp) < SIGN_TTL_MS) {
      signed = batchCached.url;
      if (__DEV__) {
        console.log(`🎯 [UNIFIED_MEDIA] Using batch-cached URL for ${objectKey} (${type})`);
      }
    } else {
      // CRITICAL FIX: Use getSignedUrlOnce instead of getSignedUrlsBatch to prevent single-item batch requests
      if (__DEV__) {
        console.log(`⚠️ [UNIFIED_MEDIA] Batch cache miss for ${objectKey} (${type}), using individual signing`);
      }
      
      // Use individual signing for single requests to avoid unnecessary batch overhead
      signed = await this.getSignedUrlOnce(objectKey, type === 'thumbnail');
    }

    // 4) CRITICAL FIX: Use global download queue protection to prevent race conditions
    // This ensures only ONE download happens across ALL instances and methods
    const globalDownloadKey = `${type}_${objectKey}`
    
    if (globalDownloadQueue.has(globalDownloadKey)) {
      if (__DEV__) {
        console.log(`⚡ [UNIFIED] Reusing in-progress download for: ${objectKey} (${type}) - DEDUPLICATION WORKING!`);
      }
      return await globalDownloadQueue.get(globalDownloadKey)
    }

    if (__DEV__) {
      console.log(`🔄 [UNIFIED] Starting new download for: ${objectKey} (${type}) - Queue size: ${globalDownloadQueue.size}`);
    }

    // Start download with global queue protection
    const downloadPromise = (async () => {
      const res = await FileSystem.downloadAsync(signed, localPath);
      if (res.status !== 200) throw new Error(`Download failed: ${res.status}`);

      if (__DEV__) {
        console.log(`✅ [UNIFIED] Download completed: ${objectKey} (${type})`);
      }

      return localPath;
    })()

    // Store in GLOBAL download queue to prevent duplicates across all instances
    globalDownloadQueue.set(globalDownloadKey, downloadPromise)

    try {
      const result = await downloadPromise
      return result
    } finally {
      // Clean up global download queue
      globalDownloadQueue.delete(globalDownloadKey)
    }
  }

  // Get cached file path (downloads if needed) - Enhanced for notification loading
  async getCachedFile(url, type = 'image', priority = 'normal') {
    if (!url) return null

    // NEW: schémas internes → utiliser l'objectKey directement
    if (url?.startsWith(SB_SCHEME_MEDIA)) {
      const objectKey = url.slice(SB_SCHEME_MEDIA.length);
      return await this.getLocalPathFromObjectKey(objectKey, 'image', priority);
    }
    if (url?.startsWith(SB_SCHEME_THUMBS)) {
      const objectKey = url.slice(SB_SCHEME_THUMBS.length);
      return await this.getLocalPathFromObjectKey(objectKey, 'thumbnail', priority);
    }

    // EXISTANT (URL signée) : extraire objectKey pour une clé de cache stable
    const objectKey = extractObjectKeyFromSignedUrl(url) || url; // fallback
    const cacheKey = objectKey;

    if (!cacheKey) return url

    const filename = cacheKey.split('/').pop()
    const baseDir = type === 'thumbnail' ? CACHE_DIRECTORIES.thumbnails : CACHE_DIRECTORIES.images;
    const localPath = `${baseDir}${cacheKey}`; // keep folder structure
    await ensureSubdirsForFile(localPath);

    // Check if file exists
    try {
      const fileInfo = await FileSystem.getInfoAsync(localPath)
      if (fileInfo.exists) {
        this.fileCache.set(cacheKey, localPath)
        if (priority === 'notification' && __DEV__) {
          console.log(`🎯 [UNIFIED_MEDIA] Cache hit for notification: ${filename}`)
        }
        return localPath
      }
    } catch (error) {
      console.warn(`⚠️ [UNIFIED_MEDIA] Error checking file existence: ${filename}`, error.message)
    }

    // Check if already downloading (use UNIFIED global queue key with object key + type)
    // This ensures deduplication works across ALL download methods
    const unifiedGlobalKey = `${type}_${cacheKey}` // Same format as getLocalPathFromObjectKey
    if (globalDownloadQueue.has(unifiedGlobalKey)) {
      if (__DEV__) {
        console.log(`⚡ [UNIFIED] Reusing in-progress download for: ${cacheKey} (${type}) - UNIFIED DEDUPLICATION WORKING!`);
      }
      return await globalDownloadQueue.get(unifiedGlobalKey)
    }

    // Download file
    if (__DEV__) {
      console.log(`🔄 [UNIFIED] Starting new unified download for: ${cacheKey} (${type}) - Queue size: ${globalDownloadQueue.size}`);
    }
    const downloadPromise = this.downloadFile(url, localPath, type, priority)
    globalDownloadQueue.set(unifiedGlobalKey, downloadPromise)

    try {
      const result = await downloadPromise
      this.fileCache.set(cacheKey, result)
      if (__DEV__) {
        console.log(`✅ [UNIFIED] Unified download completed: ${cacheKey} (${type})`);
      }
      return result
    } catch (error) {
      if (__DEV__) {
        console.warn(`❌ [UNIFIED] Unified download failed: ${cacheKey} (${type})`, error.message);
      }
      throw error
    } finally {
      globalDownloadQueue.delete(unifiedGlobalKey)
    }
  }

  // Download file with error handling
  async downloadFile(url, localPath, type, priority = 'normal') {
    try {
      // EGRESS OPTIMIZATION: Use batch signing instead of individual signing
      let signedUrl = null
      
      // First try to get from batch cache
      const batchResults = await this.getSignedUrlsBatch([url])
      signedUrl = batchResults.get(url)
      
      if (!signedUrl) throw new Error('No signed URL available from batch signing')

      // Download file
      const downloadResult = await FileSystem.downloadAsync(signedUrl, localPath)
      
      if (downloadResult.status === 200) {
        if (__DEV__ || priority === 'notification') {
          console.log(`✅ [UNIFIED_MEDIA] Downloaded ${type}:`, localPath.split('/').pop())
        }
        return localPath
      } else {
        throw new Error(`Download failed with status: ${downloadResult.status}`)
      }
    } catch (error) {
      console.error(`❌ [UNIFIED_MEDIA] Download failed for ${type}:`, error)
      return url // Fallback to original URL
    }
  }

  // Upload media with progress and thumbnail generation (ENHANCED)
  async uploadMedia(uri, mediaType, sender, receiver, onProgress = null) {
    try {
      // Debug: Log the actual objects being passed
      console.log(`🔍 [UNIFIED_MEDIA] Raw sender:`, sender)
      console.log(`🔍 [UNIFIED_MEDIA] Raw receiver:`, receiver)
      
      // Extract pseudo names safely
      const senderPseudo = typeof sender === 'string' ? sender : sender?.pseudo || 'unknown'
      const receiverPseudo = typeof receiver === 'string' ? receiver : receiver?.pseudo || 'unknown'
      
      console.log(`🚀 [UNIFIED_MEDIA] Starting upload: ${senderPseudo} → ${receiverPseudo}`)
      
      // Validate pseudo names
      if (senderPseudo === 'unknown' || receiverPseudo === 'unknown') {
        console.warn('⚠️ [UNIFIED_MEDIA] Warning: Using unknown pseudo names')
        console.log('Sender object keys:', Object.keys(sender || {}))
        console.log('Receiver object keys:', Object.keys(receiver || {}))
      }
      
      // OPTIMIZATION: Check if we're already uploading this file to prevent duplicates
      const uploadKey = `uploading_${uri}_${mediaType}`
      if (this.processingUrls && this.processingUrls.has(uploadKey)) {
        console.log('⏳ [UNIFIED_MEDIA] Upload already in progress, waiting...')
        // Wait for existing upload to complete
        return new Promise((resolve, reject) => {
          const checkInterval = setInterval(() => {
            if (!this.processingUrls.has(uploadKey)) {
              clearInterval(checkInterval)
              // Return the upload result if available
              resolve(this.uploadMedia(uri, mediaType, sender, receiver, onProgress))
            }
          }, 100)
          
          // Timeout after 30 seconds
          setTimeout(() => {
            clearInterval(checkInterval)
            reject(new Error('Upload timeout waiting for existing upload'))
          }, 30000)
        })
      }
      
      // Mark as being processed
      if (this.processingUrls) {
        this.processingUrls.add(uploadKey)
      }
      
      try {
        // Progress tracking
        if (onProgress) onProgress(0.1) // Starting
        
        // Generate thumbnail for videos
        let thumbnailUrl = null
        if (mediaType === 'video') {
          console.log('🎬 [UNIFIED_MEDIA] Generating video thumbnail...')
          try {
            const thumbnailUri = await this.generateThumbnail(uri)
            if (thumbnailUri) {
              // Upload thumbnail
              console.log('📷 [UNIFIED_MEDIA] Uploading thumbnail...')
              const thumbnailResult = await this.uploadThumbnail(thumbnailUri, senderPseudo, receiverPseudo)
              thumbnailUrl = `${SB_SCHEME_THUMBS}${thumbnailResult.fileName}` // Convert to internal sb:// format
              console.log('✅ [UNIFIED_MEDIA] Thumbnail uploaded successfully:', thumbnailUrl)
            }
          } catch (thumbnailError) {
            console.warn('⚠️ [UNIFIED_MEDIA] Thumbnail generation failed:', thumbnailError)
            // Continue without thumbnail
          }
        }
        
        if (onProgress) onProgress(0.3) // Thumbnail done
        
        // Read file
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        })

        if (onProgress) onProgress(0.5) // File read

        const timestamp = Date.now()
        const extension = mediaType === 'video' ? 'mp4' : 'jpg'
        const fileName = `${senderPseudo}/${receiverPseudo}/${timestamp}.${extension}`
        
        console.log(`📁 [UNIFIED_MEDIA] Upload path: ${fileName}`)

        // Upload to Supabase
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('media')
          .upload(fileName, decode(base64), {
            contentType: mediaType === 'video' ? 'video/mp4' : 'image/jpeg',
            cacheControl: '3600'
          })

        if (uploadError) throw uploadError

        if (onProgress) onProgress(0.8) // Upload complete

        // Pas d'URL signée longue durée : on utilisera sb:// + JIT (300s) pour les receivers
        
        // Sauvegarde locale du fichier uploadé sous le même objectKey (évite tout re-download pour le sender)
        const objectKey = uploadData.path; // ex: senderPseudo/receiverPseudo/ts.jpg
        const localCachePath = `${CACHE_DIRECTORIES.images}${objectKey}`;
        await ensureSubdirsForFile(localCachePath);
        try {
          await FileSystem.copyAsync({ from: uri, to: localCachePath });
          senderLocalIndex.media.set(objectKey, localCachePath);
        } catch (e) {
          console.warn('⚠️ [UNIFIED_MEDIA] Local copy failed (non-blocking):', e?.message);
        }

        if (onProgress) onProgress(1.0) // Complete

        const result = {
          objectKey,                           // pour debug/traçage
          mediaUrl: `${SB_SCHEME_MEDIA}${objectKey}`,     // ce que la DB recevra dans media_url
          thumbnailUrl: mediaType === 'video' ? thumbnailUrl : `${SB_SCHEME_THUMBS}${objectKey}`, // Use generated thumbnail for videos, object key for photos
          localPath: localCachePath                        // pour garder l'optimistic UI en file:// chez le sender
        }

        console.log('✅ [UNIFIED_MEDIA] Upload complete:', { 
          mediaType, 
          hasMediaUrl: !!result.mediaUrl,
          hasThumbnailUrl: !!result.thumbnailUrl 
        })

        return result
      } finally {
        // Remove from processing set
        if (this.processingUrls) {
          this.processingUrls.delete(uploadKey)
        }
      }
    } catch (error) {
      console.error('❌ [UNIFIED_MEDIA] Upload failed:', error)
      throw error
    }
  }

  // Upload thumbnail to dedicated thumbnails folder
  async uploadThumbnail(thumbnailUri, senderPseudo, receiverPseudo) {
    try {
      // Read thumbnail file
      const base64 = await FileSystem.readAsStringAsync(thumbnailUri, {
        encoding: FileSystem.EncodingType.Base64,
      })

      const timestamp = Date.now()
      const fileName = `thumbnails/${senderPseudo}/${timestamp}.jpg`
      
      console.log(`📁 [UNIFIED_MEDIA] Thumbnail upload path: ${fileName}`)

      // Upload to Supabase
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('media')
        .upload(fileName, decode(base64), {
          contentType: 'image/jpeg',
          cacheControl: '3600'
        })

      if (uploadError) throw uploadError

      // Get signed URL and cache it
      const { data: signData, error: signError } = await supabase.storage
        .from('media')
        .createSignedUrl(uploadData.path, 86400) // 24 hours

      if (signError) throw signError

      // Cache the signed URL
      this.cache.set(uploadData.path, {
        url: signData.signedUrl,
        timestamp: Date.now()
      })

      return {
        publicUrl: `${supabase.storageUrl}/object/public/media/${uploadData.path}`,
        signedUrl: signData.signedUrl,
        fileName: uploadData.path
      }
    } catch (error) {
      console.error('❌ [UNIFIED_MEDIA] Thumbnail upload failed:', error)
      throw error
    }
  }

  // Generate video thumbnail with enhanced options
  async generateThumbnail(videoUri) {
    try {
      console.log('🎬 [UNIFIED_MEDIA] Generating thumbnail for:', videoUri.split('/').pop())
      
      const { uri: thumbnailUri } = await VideoThumbnails.getThumbnailAsync(videoUri, {
        time: 1000, // 1 second into video
        quality: 0.8, // High quality for better preview
        headers: {}, // No additional headers needed
      })
      
      console.log('✅ [UNIFIED_MEDIA] Thumbnail generated:', thumbnailUri.split('/').pop())
      return thumbnailUri
    } catch (error) {
      console.error('❌ [UNIFIED_MEDIA] Thumbnail generation failed:', error)
      return null
    }
  }

  // Remove specific NSFW media file from cache and storage
  async removeNsfwMedia(url, mediaType = 'image') {
    if (!url) return false
    
    try {
      const normalizedUrl = this.normalizeUrl(url)
      let objectKey = null
      
      // Extract object key from URL
      if (url.startsWith('sb://media/')) {
        objectKey = url.slice('sb://media/'.length)
      } else if (url.includes('/media/')) {
        objectKey = extractObjectKeyFromSignedUrl(url)
      }
      
      if (objectKey) {
        // Determine cache directory based on media type
        const cacheDir = mediaType === 'video' ? CACHE_DIRECTORIES.videos : CACHE_DIRECTORIES.images
        const localPath = `${cacheDir}${objectKey}`
        
        // Remove main media file from file system
        try {
          const fileInfo = await FileSystem.getInfoAsync(localPath)
          if (fileInfo.exists) {
            await FileSystem.deleteAsync(localPath)
            if (__DEV__) console.log(`🗑️ [UNIFIED_MEDIA] Deleted NSFW ${mediaType} file:`, objectKey)
          }
        } catch (fsError) {
          if (__DEV__) console.warn(`⚠️ [UNIFIED_MEDIA] Failed to delete file from storage:`, fsError)
        }
        
        // Also remove thumbnail if it exists (for videos)
        if (mediaType === 'video') {
          try {
            const thumbnailPath = `${CACHE_DIRECTORIES.thumbnails}${objectKey}`
            const thumbnailInfo = await FileSystem.getInfoAsync(thumbnailPath)
            if (thumbnailInfo.exists) {
              await FileSystem.deleteAsync(thumbnailPath)
              if (__DEV__) console.log(`🗑️ [UNIFIED_MEDIA] Deleted NSFW video thumbnail:`, objectKey)
            }
          } catch (thumbError) {
            if (__DEV__) console.warn(`⚠️ [UNIFIED_MEDIA] Failed to delete video thumbnail:`, thumbError)
          }
        }
        
        // Remove from sender local index if it exists
        if (senderLocalIndex.media.has(objectKey)) {
          senderLocalIndex.media.delete(objectKey)
        }
        if (senderLocalIndex.thumbs.has(objectKey)) {
          senderLocalIndex.thumbs.delete(objectKey)
        }
      }
      
      // Remove from memory caches
      this.cache.delete(normalizedUrl)
      this.fileCache.delete(normalizedUrl)
      this.processingUrls.delete(normalizedUrl)
      
      // Remove from global caches
      if (objectKey) {
        const signK = signKey(objectKey, false)
        const signKThumb = signKey(objectKey, true)
        signCache.delete(signK)
        signCache.delete(signKThumb)
        signInFlight.delete(signK)
        signInFlight.delete(signKThumb)
        globalDownloadQueue.delete(objectKey)
      }
      
      if (__DEV__) console.log(`✅ [UNIFIED_MEDIA] NSFW ${mediaType} removed from all caches:`, objectKey || normalizedUrl)
      return true
      
    } catch (error) {
      console.error('❌ [UNIFIED_MEDIA] Failed to remove NSFW media:', error)
      return false
    }
  }

  // Clear cache
  clearCache() {
    this.cache.clear()
    this.fileCache.clear()
    this.downloadQueue.clear()
    this.processingUrls.clear()
    
    if (__DEV__) console.log('🧹 [UNIFIED_MEDIA] Cache cleared')
  }

  // Get cache stats
  getCacheStats() {
    return {
      signedUrls: this.cache.size,
      files: this.fileCache.size,
      activeDownloads: this.downloadQueue.size,
      processing: this.processingUrls.size
    }
  }
}

// Export singleton instance
export const unifiedMediaService = new UnifiedMediaService()

// Backward compatibility exports
export const getSignedUrl = (url) => unifiedMediaService.getSignedUrl(url)
export const getSignedUrlsBatch = (urls) => unifiedMediaService.getSignedUrlsBatch(urls)
export const getCachedImage = (url) => unifiedMediaService.getCachedFile(url, 'image')
export const getCachedVideo = (url) => unifiedMediaService.getCachedFile(url, 'video')
export const uploadMedia = (uri, type, sender, receiver, onProgress) => 
  unifiedMediaService.uploadMedia(uri, type, sender, receiver, onProgress)

export default unifiedMediaService
