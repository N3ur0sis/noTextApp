import * as Network from 'expo-network';

/**
 * Network connectivity service
 * Provides utilities to detect network connectivity and manage offline states
 */
export class NetworkService {
  static _isConnected = true;
  static _connectionListeners = new Set();
  static _initialized = false;

  /**
   * Initialize network monitoring
   */
  static async initialize() {
    if (this._initialized) return;

    try {
      // Get initial network state
      const networkState = await Network.getNetworkStateAsync();
      this._isConnected = networkState.isConnected && networkState.isInternetReachable;
      
      console.log('🌐 [NETWORK] Initial connection state:', this._isConnected);
      this._initialized = true;
    } catch (error) {
      console.error('❌ [NETWORK] Failed to initialize network monitoring:', error);
      // Assume connected if we can't check
      this._isConnected = true;
      this._initialized = true;
    }
  }

  /**
   * Check if device is currently connected to the internet with enhanced detection
   */
  static async isConnected() {
    if (!this._initialized) {
      await this.initialize();
    }

    try {
      const networkState = await Network.getNetworkStateAsync();
      let connected = networkState.isConnected && networkState.isInternetReachable;
      
      // Enhanced connection verification - sometimes isInternetReachable is null
      if (networkState.isConnected && networkState.isInternetReachable === null) {
        console.log('🌐 [NETWORK] Internet reachability unknown, performing additional check...');
        
        // Try a simple network request to verify actual internet connectivity
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
          
          const response = await fetch('https://www.google.com/generate_204', {
            method: 'HEAD',
            signal: controller.signal,
            cache: 'no-cache'
          });
          
          clearTimeout(timeoutId);
          connected = response.ok;
          console.log('🌐 [NETWORK] Network verification result:', connected);
        } catch (fetchError) {
          console.log('🌐 [NETWORK] Network verification failed, assuming offline');
          connected = false;
        }
      }
      
      // Update internal state
      if (this._isConnected !== connected) {
        this._isConnected = connected;
        console.log('🌐 [NETWORK] Connection state changed:', connected);
        this._notifyListeners(connected);
      }
      
      return connected;
    } catch (error) {
      console.error('❌ [NETWORK] Error checking connectivity:', error);
      // Return last known state if check fails, but assume offline if never initialized
      return this._isConnected;
    }
  }

  /**
   * Get detailed network information
   */
  static async getNetworkInfo() {
    try {
      const networkState = await Network.getNetworkStateAsync();
      return {
        isConnected: networkState.isConnected && networkState.isInternetReachable,
        type: networkState.type,
        isWifi: networkState.type === Network.NetworkStateType.WIFI,
        isCellular: networkState.type === Network.NetworkStateType.CELLULAR,
        details: networkState
      };
    } catch (error) {
      console.error('❌ [NETWORK] Error getting network info:', error);
      return {
        isConnected: this._isConnected,
        type: Network.NetworkStateType.UNKNOWN,
        isWifi: false,
        isCellular: false,
        details: null
      };
    }
  }

  /**
   * Add listener for connectivity changes
   */
  static addConnectionListener(callback) {
    this._connectionListeners.add(callback);
    
    // Return unsubscribe function
    return () => {
      this._connectionListeners.delete(callback);
    };
  }

  /**
   * Execute a function with network retry logic
   */
  static async withRetry(asyncFunction, maxRetries = 3, delay = 1000) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Check if we're connected before attempting
        const isConnected = await this.isConnected();
        if (!isConnected) {
          throw new Error('No internet connection available');
        }
        
        console.log(`🌐 [NETWORK] Attempt ${attempt}/${maxRetries}`);
        const result = await asyncFunction();
        console.log(`✅ [NETWORK] Success on attempt ${attempt}`);
        return result;
      } catch (error) {
        lastError = error;
        console.warn(`⚠️ [NETWORK] Attempt ${attempt}/${maxRetries} failed:`, error.message);
        
        // Don't retry for certain types of errors
        if (error.message?.includes('pseudo') || 
            error.message?.includes('unauthorized') ||
            error.message?.includes('forbidden')) {
          console.log('🛑 [NETWORK] Non-retryable error, stopping retries');
          throw error;
        }
        
        // Wait before next attempt (except on last attempt)
        if (attempt < maxRetries) {
          const waitTime = delay * Math.pow(2, attempt - 1); // Exponential backoff
          console.log(`⏳ [NETWORK] Waiting ${waitTime}ms before next attempt...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    console.error(`❌ [NETWORK] All ${maxRetries} attempts failed`);
    throw lastError;
  }

  /**
   * Check if error is network-related and retryable
   */
  static isRetryableError(error) {
    const retryableMessages = [
      'network request failed',
      'timeout',
      'connection refused',
      'no internet',
      'offline',
      'fetch failed'
    ];
    
    const errorMessage = error.message?.toLowerCase() || '';
    return retryableMessages.some(msg => errorMessage.includes(msg));
  }

  /**
   * Remove all connection listeners
   */
  static clearConnectionListeners() {
    this._connectionListeners.clear();
  }

  /**
   * Notify all listeners about connection changes
   */
  static _notifyListeners(isConnected) {
    this._connectionListeners.forEach(callback => {
      try {
        callback(isConnected);
      } catch (error) {
        console.error('❌ [NETWORK] Error in connection listener:', error);
      }
    });
  }

  /**
   * Wait for network connection
   * Returns a promise that resolves when network becomes available
   */
  static async waitForConnection(timeout = 30000) {
    const isCurrentlyConnected = await this.isConnected();
    if (isCurrentlyConnected) return true;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        unsubscribe();
        reject(new Error('Network connection timeout'));
      }, timeout);

      const unsubscribe = this.addConnectionListener((connected) => {
        if (connected) {
          clearTimeout(timeoutId);
          unsubscribe();
          resolve(true);
        }
      });

      // Check again immediately in case connection came back
      this.isConnected().then(connected => {
        if (connected) {
          clearTimeout(timeoutId);
          unsubscribe();
          resolve(true);
        }
      });
    });
  }

  /**
   * Execute a function with network retry logic
   */
  static async withRetry(asyncFunction, maxRetries = 3, baseDelay = 1000) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Check network before attempting
        const connected = await this.isConnected();
        if (!connected && attempt < maxRetries) {
          console.log(`🔄 [NETWORK] No connection, waiting for retry ${attempt + 1}/${maxRetries + 1}`);
          
          // Wait for connection or delay
          try {
            await Promise.race([
              this.waitForConnection(5000),
              new Promise(resolve => setTimeout(resolve, baseDelay * Math.pow(2, attempt)))
            ]);
          } catch (waitError) {
            // Continue to next attempt even if waiting fails
          }
          continue;
        }

        // Execute the function
        return await asyncFunction();
      } catch (error) {
        console.log(`❌ [NETWORK] Attempt ${attempt + 1}/${maxRetries + 1} failed:`, error.message);
        
        if (attempt === maxRetries) {
          throw error; // Last attempt, rethrow the error
        }

        // Wait before retry with exponential backoff
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}