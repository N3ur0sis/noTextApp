import { router } from 'expo-router';
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Colors } from '../constants/Design';
import { Config } from '../constants/Config';
import { useAuthContext } from '../context/AuthContext';
import AuthScreen from '../screens/AuthScreen';

export default function Index() {
  const { user, loading } = useAuthContext();

  // Optimized navigation with no unnecessary re-renders
  useEffect(() => {
    // Track if this effect has already redirected
    let hasRedirected = false;
    
    if (user && !loading && !hasRedirected) {
      hasRedirected = true;
      
      // Use replace instead of push for cleaner navigation history
      // This prevents going back to splash screen
      router.replace('/home');
    }
  }, [user, loading]);

  // Production build info (only in non-production)
  useEffect(() => {
    if (Config.ENABLE_DEBUG_LOGS) {
      console.log('🚀 App Starting:', {
        profile: Config.BUILD_PROFILE,
        version: Config.VERSION,
        buildTime: Config.BUILD_TIME,
      });
    }
  }, []);

  // Simplified render logic
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.white} />
      </View>
    );
  }

  // AuthScreen handles the case when user is not authenticated
  return user ? <View style={styles.container} /> : <AuthScreen />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
