import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useEffect, useState, useCallback } from 'react'
import {
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native'
import { BorderRadius, Colors, Spacing, Typography } from '../constants/Design'
import { useAuthContext } from '../context/AuthContext'
import { getSafeAreaTop } from '../utils/responsive'

const ProfileScreen = () => {
  const { user: contextUser } = useAuthContext()
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadUserProfile = useCallback(async () => {
    try {
      setIsLoading(true)
      if (contextUser) {
        setUser(contextUser)
      }
    } finally {
      setIsLoading(false)
    }
  }, [contextUser])

  useEffect(() => {
    loadUserProfile()
  }, [loadUserProfile])

  const handleGoBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.back()
  }

  if (isLoading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Chargement...</Text>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={handleGoBack}
        >
          <Ionicons name="arrow-back" size={24} color={Colors.white} />
        </TouchableOpacity>
        <Text style={styles.title}>Profil</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Content */}
      <View style={styles.content}>
        {/* Profile Icon */}
        <View style={styles.profileIconContainer}>
          <View style={styles.profileIcon}>
            <Ionicons name="person" size={40} color={Colors.white} />
          </View>
        </View>

        {/* Profile Information */}
        <View style={styles.form}>
          {/* Pseudo Display */}
          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>Pseudo</Text>
            <View style={styles.displayContainer}>
              <Text style={styles.displayText}>{user?.pseudo || 'Non défini'}</Text>
            </View>
          </View>

          {/* Account Info */}
          <View style={styles.infoSection}>
            <Text style={styles.infoTitle}>Informations du compte</Text>
            
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Date de création</Text>
              <Text style={styles.infoValue}>
                {user?.created_at ? new Date(user.created_at).toLocaleDateString('fr-FR') : 'Non disponible'}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.black,
  },
  
  // Loading
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: Typography.base,
    color: Colors.white,
  },
  
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: getSafeAreaTop(),
    paddingHorizontal: Spacing.screen,
    paddingBottom: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray800,
  },
  backButton: {
    padding: Spacing.sm,
    marginLeft: -Spacing.sm,
  },
  title: {
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
    color: Colors.white,
  },
  placeholder: {
    width: 24 + Spacing.sm * 2,
  },
  
  // Content
  content: {
    flex: 1,
    paddingHorizontal: Spacing.screen,
    paddingTop: Spacing.xl,
  },
  
  // Profile Icon
  profileIconContainer: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  profileIcon: {
    width: 80,
    height: 80,
    backgroundColor: Colors.gray800,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.gray700,
  },
  
  // Form
  form: {
    flex: 1,
  },
  fieldContainer: {
    marginBottom: Spacing.lg,
  },
  fieldLabel: {
    fontSize: Typography.small,
    fontWeight: Typography.medium,
    color: Colors.gray400,
    marginBottom: Spacing.xs,
  },
  displayContainer: {
    backgroundColor: Colors.gray900,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.gray800,
  },
  displayText: {
    fontSize: Typography.base,
    color: Colors.white,
    fontWeight: Typography.light,
  },
  
  // Info Section
  infoSection: {
    backgroundColor: Colors.gray900,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginTop: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.gray800,
  },
  infoTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.white,
    marginBottom: Spacing.md,
  },
  infoItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  infoLabel: {
    fontSize: Typography.base,
    color: Colors.gray400,
  },
  infoValue: {
    fontSize: Typography.base,
    color: Colors.white,
    fontWeight: Typography.light,
  },
})

export default ProfileScreen
