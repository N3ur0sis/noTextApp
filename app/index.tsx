import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../constants/Design';
import { Config } from '../constants/Config';
import { useAuthContext } from '../context/AuthContext';
import AuthScreen from '../screens/AuthScreen';

export default function Index() {
  const { user, loading, authState, connectionState } = useAuthContext();
  const [initializationState, setInitializationState] = useState('starting');

  // Enhanced navigation with better state tracking
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

  // Track initialization progress
  useEffect(() => {
    if (loading) {
      if (connectionState === 'disconnected') {
        setInitializationState('offline');
      } else {
        setInitializationState('loading');
      }
    } else if (user) {
      setInitializationState('authenticated');
    } else {
      setInitializationState('ready');
    }
  }, [loading, connectionState, user]);

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

  // Enhanced loading states with better user feedback
  if (loading) {
    let loadingText = 'Démarrage...';
    let showOfflineIndicator = false;
    
    switch (initializationState) {
      case 'recovering':
        loadingText = 'Récupération du compte...';
        break;
      case 'authenticating':
        loadingText = 'Authentification...';
        break;
      case 'offline':
        loadingText = 'Mode hors ligne';
        showOfflineIndicator = true;
        break;
      case 'loading':
        loadingText = 'Chargement...';
        break;
    }
    
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.white} />
        <Text style={styles.loadingText}>{loadingText}</Text>
        {showOfflineIndicator && (
          <Text style={styles.offlineText}>
            Vérifiez votre connexion internet
          </Text>
        )}

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
  loadingText: {
    color: Colors.white,
    fontSize: 16,
    marginTop: 20,
    textAlign: 'center',
  },
  offlineText: {
    color: Colors.gray500,
    fontSize: 14,
    marginTop: 10,
    textAlign: 'center',
  },
  recoveryText: {
    color: Colors.accent,
    fontSize: 14,
    marginTop: 10,
    textAlign: 'center',
  },
});
