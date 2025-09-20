import React, { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { Colors, Spacing, Typography, BorderRadius } from '../constants/Design'
import { useAuthContext } from '../context/AuthContext'
import { blockService } from '../services/blockService'
import { apiManager } from '../services/apiManager'
import AppStatusBar from '../components/AppStatusBar'
import { getSafeAreaTop } from '../utils/responsive'

export default function BlockedUsersScreen() {
  const { currentUser } = useAuthContext()
  const [blockedUsers, setBlockedUsers] = useState([])
  const [blockedUsersDetails, setBlockedUsersDetails] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Load blocked users list
  const loadBlockedUsers = useCallback(async () => {
    try {
      const blockedIds = await blockService.getBlockedUsers()
      setBlockedUsers(blockedIds)

      // Get blocked users with their stored details
      const details = await blockService.getBlockedUsersWithDetails()
      setBlockedUsersDetails(details)
      
      console.log('📵 [BLOCKED-SCREEN] Loaded blocked users:', details)
    } catch (error) {
      console.error('❌ [BLOCKED] Error loading blocked users:', error)
      Alert.alert('Erreur', 'Impossible de charger la liste des utilisateurs bloqués.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // Initialize on mount
  useEffect(() => {
    loadBlockedUsers()

    // Listen for block list changes
    const unsubscribe = blockService.addListener((updatedBlockedUsers) => {
      setBlockedUsers(updatedBlockedUsers)
      loadBlockedUsers() // Reload to get updated details
    })

    return unsubscribe
  }, [loadBlockedUsers])

  // Handle refresh
  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    loadBlockedUsers()
  }, [loadBlockedUsers])

  // Handle unblock user
  const handleUnblockUser = useCallback((user) => {
    Alert.alert(
      'Débloquer l\'utilisateur',
      `Voulez-vous débloquer ${user.pseudo} ?\n\nVous pourrez à nouveau recevoir des messages et notifications de cette personne.`,
      [
        {
          text: 'Annuler',
          style: 'cancel'
        },
        {
          text: 'Débloquer',
          style: 'default',
          onPress: async () => {
            try {
              const success = await blockService.unblockUser(String(user.id))
              if (success) {
                Alert.alert(
                  'Utilisateur débloqué',
                  `${user.pseudo} a été débloqué avec succès.`,
                  [{ text: 'OK' }]
                )
              } else {
                Alert.alert('Erreur', 'L\'utilisateur n\'était pas bloqué.')
              }
            } catch (error) {
              console.error('❌ [BLOCKED] Error unblocking user:', error)
              Alert.alert('Erreur', 'Impossible de débloquer l\'utilisateur.')
            }
          }
        }
      ]
    )
  }, [])

  // Clear all blocked users
  const handleClearAll = useCallback(() => {
    if (blockedUsers.length === 0) return

    Alert.alert(
      'Débloquer tous les utilisateurs',
      `Voulez-vous débloquer tous les ${blockedUsers.length} utilisateurs bloqués ?`,
      [
        {
          text: 'Annuler',
          style: 'cancel'
        },
        {
          text: 'Débloquer tous',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockService.clearAllBlocked()
              Alert.alert(
                'Tous les utilisateurs débloqués',
                'Vous pourrez à nouveau recevoir des messages de tous les utilisateurs.',
                [{ text: 'OK' }]
              )
            } catch (error) {
              console.error('❌ [BLOCKED] Error clearing all blocked users:', error)
              Alert.alert('Erreur', 'Impossible de débloquer tous les utilisateurs.')
            }
          }
        }
      ]
    )
  }, [blockedUsers.length])

  // Render blocked user item
  const renderBlockedUser = useCallback(({ item }) => (
    <View style={styles.userItem}>
      <View style={styles.userInfo}>
        <Text style={styles.userPseudo}>{item.pseudo}</Text>
        {!item.isPlaceholder && (item.age || item.sexe) && (
          <Text style={styles.userDetails}>
            {item.age ? `${item.age} ans` : ''}{item.age && item.sexe ? ' • ' : ''}{item.sexe || ''}
          </Text>
        )}
        {item.isPlaceholder && (
          <Text style={styles.placeholderText}>Informations non disponibles</Text>
        )}
      </View>
      <TouchableOpacity
        style={styles.unblockButton}
        onPress={() => handleUnblockUser(item)}
      >
        <Ionicons name="checkmark-circle-outline" size={20} color={Colors.success} />
        <Text style={styles.unblockText}>Débloquer</Text>
      </TouchableOpacity>
    </View>
  ), [handleUnblockUser])

  return (
    <View style={styles.container}>
      <AppStatusBar />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={24} color={Colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Utilisateurs bloqués</Text>
        {blockedUsers.length > 0 && (
          <TouchableOpacity
            style={styles.clearAllButton}
            onPress={handleClearAll}
          >
            <Text style={styles.clearAllText}>Tout débloquer</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Content */}
      <View style={styles.content}>
        {loading ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.loadingText}>Chargement...</Text>
          </View>
        ) : blockedUsersDetails.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="ban" size={64} color={Colors.gray500} />
            <Text style={styles.emptyTitle}>Aucun utilisateur bloqué</Text>
            <Text style={styles.emptyDescription}>
              Les utilisateurs que vous bloquez apparaîtront ici.{'\n'}
              Vous pouvez les débloquer à tout moment.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.infoContainer}>
              <Text style={styles.infoText}>
                {blockedUsersDetails.length} utilisateur{blockedUsersDetails.length > 1 ? 's' : ''} bloqué{blockedUsersDetails.length > 1 ? 's' : ''}
              </Text>
            </View>
            
            <FlatList
              data={blockedUsersDetails}
              renderItem={renderBlockedUser}
              keyExtractor={(item) => String(item.id)}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                  tintColor={Colors.white}
                  colors={[Colors.white]}
                />
              }
            />
          </>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.black,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: getSafeAreaTop(),
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    backgroundColor: Colors.black,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray800,
  },
  backButton: {
    padding: Spacing.sm,
    marginLeft: -Spacing.sm,
  },
  headerTitle: {
    flex: 1,
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
    color: Colors.white,
    textAlign: 'center',
    marginHorizontal: Spacing.md,
  },
  clearAllButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.fire,
    borderRadius: BorderRadius.sm,
  },
  clearAllText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.white,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.md,
  },
  infoContainer: {
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  infoText: {
    fontSize: Typography.sm,
    color: Colors.gray400,
    textAlign: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: Spacing.xl,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.gray900,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
  },
  userInfo: {
    flex: 1,
  },
  userPseudo: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.white,
    marginBottom: Spacing.xs,
  },
  userDetails: {
    fontSize: Typography.sm,
    color: Colors.gray400,
  },
  placeholderText: {
    fontSize: Typography.sm,
    color: Colors.gray500,
    fontStyle: 'italic',
  },
  unblockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.gray800,
    borderRadius: BorderRadius.sm,
    marginLeft: Spacing.md,
  },
  unblockText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.success,
    marginLeft: Spacing.xs,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  emptyTitle: {
    fontSize: Typography.lg,
    fontWeight: Typography.semibold,
    color: Colors.white,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  emptyDescription: {
    fontSize: Typography.base,
    color: Colors.gray400,
    textAlign: 'center',
    lineHeight: 22,
  },
  loadingText: {
    fontSize: Typography.base,
    color: Colors.gray400,
    textAlign: 'center',
  },
})
