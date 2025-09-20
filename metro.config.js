const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Production optimizations for preview and production builds
if (process.env.NODE_ENV === 'production' || process.env.EXPO_PUBLIC_ENV === 'preview') {
  // Enable aggressive tree shaking
  config.transformer.minifierConfig = {
    mangle: true,
    keep_fnames: false,
    keep_classnames: false,
  };
  
  // Enable source map generation for crash reporting
  config.transformer.enableBabelRCLookup = false;
  
  // Optimize bundle splitting
  config.serializer.createModuleIdFactory = function() {
    const projectRootPath = config.projectRoot;
    return function(path) {
      let name = path.substr(projectRootPath.length + 1);
      return name;
    };
  };
  
  // Remove console logs in production
  config.transformer.minifierPath = require.resolve('metro-minify-terser');
  config.transformer.minifierConfig = {
    ...config.transformer.minifierConfig,
    drop_console: true,
  };
}

// Asset optimization
config.resolver.assetExts.push('db', 'mp3', 'ttf', 'obj', 'png', 'jpg');

// Ensure proper resolution for production builds
config.resolver.platforms = ['native', 'ios', 'android'];

module.exports = config;
