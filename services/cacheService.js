/**
 * OPTIMIZED UNIFIED CACHE SERVICE
 * Streamlined interface that directly uses apiManager with improved performance
 * Adds LRU cache eviction and memory usage optimization
 */

import { apiManager } from './apiManager';

class UnifiedCacheService {
  constructor() {
    this._persistenceTimeout = null;
    this._memoryUsage = 0;
    this._maxMemoryUsage = 20 * 1024 * 1024; // 20MB max cache size
    this._lastAccess = new Map(); // Track LRU for efficient cache eviction
  }

  // Get from cache with LRU tracking
  get(category, key) {
    const cacheKey = `${category}:${key}`;
    const cached = apiManager.cache.get(cacheKey);
    
    if (cached) {
      // Update last access time for LRU
      this._lastAccess.set(cacheKey, Date.now());
      return cached.data;
    }
    
    return null;
  }

  // Set with persistence and memory monitoring
  setWithPersist(category, key, value) {
    const cacheKey = `${category}:${key}`;
    // Estimate size of data to track memory usage
    const estimatedSize = this._estimateSize(value);
    
    // Check if we need to evict cache entries
    this._checkMemoryUsage(estimatedSize);
    
    apiManager.cache.set(cacheKey, {
      data: value,
      timestamp: Date.now(),
      size: estimatedSize
    });
    
    // Update memory tracking
    this._memoryUsage += estimatedSize;
    this._lastAccess.set(cacheKey, Date.now());
    
    apiManager.markAsPersistent(cacheKey);
    this._schedulePersistence();
  }

  // Regular set with memory monitoring
  set(category, key, value) {
    const cacheKey = `${category}:${key}`;
    const estimatedSize = this._estimateSize(value);
    
    // Check if we need to evict cache entries
    this._checkMemoryUsage(estimatedSize);
    
    apiManager.cache.set(cacheKey, {
      data: value,
      timestamp: Date.now(),
      size: estimatedSize
    });
    
    // Update memory tracking
    this._memoryUsage += estimatedSize;
    this._lastAccess.set(cacheKey, Date.now());
  }

  // Memory-aware cache management
  _checkMemoryUsage(incomingSize) {
    if (this._memoryUsage + incomingSize > this._maxMemoryUsage) {
      this._evictLRUEntries(incomingSize);
    }
  }

  // Evict least recently used entries to free memory
  _evictLRUEntries(neededSpace) {
    // Sort by last access time (oldest first)
    const entries = Array.from(this._lastAccess.entries())
      .sort((a, b) => a[1] - b[1]);
      
    let freedSpace = 0;
    for (const [key, time] of entries) {
      if (this._memoryUsage - freedSpace + neededSpace <= this._maxMemoryUsage) {
        break;
      }
      
      const cached = apiManager.cache.get(key);
      if (cached && cached.size) {
        freedSpace += cached.size;
        apiManager.cache.delete(key);
        this._lastAccess.delete(key);
      }
    }
    
    this._memoryUsage -= freedSpace;
  }

  // Estimate size of an object in bytes
  _estimateSize(obj) {
    const jsonString = JSON.stringify(obj);
    // Approximate size: 2 bytes per character in UTF-16
    return jsonString ? jsonString.length * 2 : 0;
  }

  // Check if exists
  has(category, key) {
    return apiManager.cache.has(`${category}:${key}`);
  }

  // Delete with memory tracking
  delete(category, key) {
    const cacheKey = `${category}:${key}`;
    const cached = apiManager.cache.get(cacheKey);
    
    if (cached && cached.size) {
      this._memoryUsage -= cached.size;
    }
    
    apiManager.cache.delete(cacheKey);
    this._lastAccess.delete(cacheKey);
  }

  // Clear all with memory reset
  clear(type = 'all') {
    if (type === 'all') {
      apiManager.cache.clear();
      this._lastAccess.clear();
      this._memoryUsage = 0;
    }
  }

  // Schedule persistence with debouncing
  _schedulePersistence() {
    if (this._persistenceTimeout) {
      clearTimeout(this._persistenceTimeout);
    }
    this._persistenceTimeout = setTimeout(() => {
      apiManager._persistCacheToStorage();
      this._persistenceTimeout = null;
    }, 200);
  }

  // Persist cache immediately
  async persistCache() {
    if (this._persistenceTimeout) {
      clearTimeout(this._persistenceTimeout);
      this._persistenceTimeout = null;
    }
    return apiManager._persistCacheToStorage();
  }
}

export default new UnifiedCacheService()
