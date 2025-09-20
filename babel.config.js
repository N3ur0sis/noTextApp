module.exports = function (api) {
  api.cache(true);
  const isProduction = process.env.NODE_ENV === 'production' || process.env.EXPO_PUBLIC_ENV === 'preview';
  
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // OPTIMIZATION: Remove console.log in production builds, keep error/warn for debugging
      ...(isProduction ? [
        ['transform-remove-console', { exclude: ['error', 'warn'] }]
      ] : []),
      'babel-plugin-react-compiler',
      'react-native-reanimated/plugin', // 👈 Must be last
    ],
  };
};
