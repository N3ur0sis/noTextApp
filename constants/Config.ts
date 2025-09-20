/**
 * ENVIRONMENT CONFIGURATION
 * Controls app behavior based on build profile
 */

const env = process.env.EXPO_PUBLIC_ENV || 'development';

export const Config = {
  // Environment flags
  IS_DEVELOPMENT: env === 'development',
  IS_PREVIEW: env === 'preview', 
  IS_PRODUCTION: env === 'production',
  
  // Feature flags
  ENABLE_DEBUG_LOGS: env === 'development',
  ENABLE_PERFORMANCE_MONITOR: env !== 'production',
  ENABLE_DEV_TOOLS: env === 'development',
  
  // API Configuration
  API_TIMEOUT: env === 'development' ? 10000 : 5000,
  CACHE_TTL: {
    MESSAGES: env === 'development' ? 30000 : 60000, // 30s dev, 1min prod
    CONVERSATIONS: env === 'development' ? 60000 : 300000, // 1min dev, 5min prod
    USER_DATA: 900000, // 15min for all environments
  },
  
  // Performance Settings
  MAX_CONCURRENT_REQUESTS: env === 'development' ? 3 : 5,
  DEBOUNCE_DELAY: env === 'development' ? 500 : 300,
  
  // Build Info
  BUILD_PROFILE: env,
  VERSION: require('../package.json').version,
  BUILD_TIME: new Date().toISOString(),
};

// Log configuration on startup (only in dev)
if (Config.ENABLE_DEBUG_LOGS) {
  console.log('🔧 App Configuration:', {
    environment: env,
    profile: Config.BUILD_PROFILE,
    debugLogs: Config.ENABLE_DEBUG_LOGS,
    version: Config.VERSION,
  });
}
