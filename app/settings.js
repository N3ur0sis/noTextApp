import { Ionicons } from '@expo/vector-icons'
import Constants from 'expo-constants'
import { router } from 'expo-router'
import { useState, useEffect } from 'react'
import {
    Alert,
    Linking,
    Modal,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native'
import { BorderRadius, Colors, Spacing, Typography } from '../constants/Design'
import { useAuthContext } from '../context/AuthContext'
import { getSafeAreaTop } from '../utils/responsive'
import ReportUserModal from '../components/ReportUserModal'
import ReportEmailService from '../services/reportEmailService'
import { blockService } from '../services/blockService'

const SettingsScreen = () => {
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showReportModal, setShowReportModal] = useState(false)
  const [blockedUsersCount, setBlockedUsersCount] = useState(0)
  const { deleteAccount, user: currentUser } = useAuthContext()

  // Load blocked users count
  useEffect(() => {
    const loadBlockedCount = async () => {
      const count = await blockService.getBlockedUsersCount()
      setBlockedUsersCount(count)
    }

    loadBlockedCount()

    // Listen for block list changes
    const unsubscribe = blockService.addListener(async () => {
      const count = await blockService.getBlockedUsersCount()
      setBlockedUsersCount(count)
    })

    return unsubscribe
  }, [])

  const handleGoBack = () => {
    router.back()
  }

  const handleDeleteAccount = () => {
    setShowDeleteModal(true)
  }

  const handleReportSubmit = async (reportData) => {
    try {
      await ReportEmailService.sendReport(reportData)
      console.log('✅ [SETTINGS] Report submitted successfully')
    } catch (error) {
      console.error('❌ [SETTINGS] Failed to submit report:', error)
      // The modal will show its own error message
      throw error
    }
  }

  const confirmDeleteAccount = async () => {
    try {
      setIsDeleting(true)
      console.log('🗑️ Starting account deletion from settings...')
      
      const result = await deleteAccount()
      
      console.log('✅ Account deletion successful:', result)
      setShowDeleteModal(false)
      
      // Show success message
      Alert.alert(
        'Compte supprimé',
        `Votre compte a été supprimé avec succès. Toutes vos données ont été effacées.`,
        [
          { 
            text: 'OK', 
            onPress: () => router.replace('/auth')
          }
        ]
      )
    } catch (error) {
      console.error('❌ Account deletion error:', error)
      setIsDeleting(false)
      
      Alert.alert(
        'Erreur de suppression',
        `Impossible de supprimer complètement votre compte: ${error.message}\n\nVeuillez réessayer ou contactez le support.`,
        [
          { text: 'Réessayer', onPress: () => confirmDeleteAccount() },
          { text: 'Annuler', style: 'cancel' }
        ]
      )
    }
  }

  const cancelDeleteAccount = () => {
    setShowDeleteModal(false)
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
        <Text style={styles.title}>Paramètres</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Settings Content */}
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        
        {/* Account Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Compte</Text>
          
          <TouchableOpacity 
            style={styles.settingItem}
            onPress={() => router.push('/profile')}
          >
            <View style={styles.settingItemLeft}>
              <Ionicons name="person-outline" size={20} color={Colors.white} />
              <Text style={styles.settingItemText}>Profil</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.gray500} />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.settingItem}
            onPress={() => router.push('/privacy')}
          >
            <View style={styles.settingItemLeft}>
              <Ionicons name="shield-outline" size={20} color={Colors.white} />
              <Text style={styles.settingItemText}>Confidentialité</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.gray500} />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.settingItem}
            onPress={() => {
              console.log('📱 [SETTINGS] Navigating to blocked users')
              router.push('/blocked-users')
            }}
          >
            <View style={styles.settingItemLeft}>
              <Ionicons name="ban" size={20} color={Colors.white} />
              <Text style={styles.settingItemText}>Utilisateurs bloqués</Text>
            </View>
            <View style={styles.settingItemRight}>
              {blockedUsersCount > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countText}>{blockedUsersCount}</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={20} color={Colors.gray500} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Legal Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Légal</Text>
          
          <TouchableOpacity 
            style={styles.settingItem}
            onPress={() => setShowReportModal(true)}
          >
            <View style={styles.settingItemLeft}>
              <Ionicons name="flag-outline" size={20} color={Colors.white} />
              <Text style={styles.settingItemText}>Signaler un utilisateur ou un contenu</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.gray500} />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.settingItem}
            onPress={() => Linking.openURL('mailto:contact@solodesign.fr?subject=NoText Support')}
          >
            <View style={styles.settingItemLeft}>
              <Ionicons name="mail-outline" size={20} color={Colors.white} />
              <Text style={styles.settingItemText}>Contacter le support</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.gray500} />
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.settingItem}
            onPress={() => router.push('/help')}
          >
            <View style={styles.settingItemLeft}>
              <Ionicons name="help-circle-outline" size={20} color={Colors.white} />
              <Text style={styles.settingItemText}>Aide</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.gray500} />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.settingItem}
            onPress={() => router.push('/cgu')}
          >
            <View style={styles.settingItemLeft}>
              <Ionicons name="document-text-outline" size={20} color={Colors.white} />
              <Text style={styles.settingItemText}>Conditions d&apos;utilisation</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.gray500} />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.settingItem}
            onPress={() => Linking.openURL('https://notext.carrd.co#privacy')}
          >
            <View style={styles.settingItemLeft}>
              <Ionicons name="link-outline" size={20} color={Colors.white} />
              <Text style={styles.settingItemText}>Politique de confidentialité (site web)</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.gray500} />
          </TouchableOpacity>
        </View>

        {/* App Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Application</Text>
          
          <View style={styles.settingItem}>
            <View style={styles.settingItemLeft}>
              <Ionicons name="information-circle-outline" size={20} color={Colors.white} />
              <Text style={styles.settingItemText}>Version</Text>
            </View>
            <Text style={styles.versionText}>{Constants.expoConfig?.version ?? '1.0.0'}</Text>
          </View>
        </View>

        {/* Danger Zone */}
        <View style={styles.dangerSection}>
          <TouchableOpacity 
            style={styles.deleteButton}
            onPress={handleDeleteAccount}
          >
            <Ionicons name="trash-outline" size={20} color={Colors.fire} />
            <Text style={styles.deleteButtonText}>Supprimer le compte</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={cancelDeleteAccount}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalIcon}>
              <Ionicons name="warning" size={32} color={Colors.fire} />
            </View>
            
            <Text style={styles.modalTitle}>Supprimer le compte</Text>
            <Text style={styles.modalMessage}>
              Êtes-vous sûr de vouloir supprimer votre compte ? Cette action vous déconnectera définitivement et supprimera toutes vos données.
            </Text>
            <Text style={styles.modalWarning}>
              • Votre compte sera définitivement supprimé{'\n'}
              • Vous serez automatiquement déconnecté{'\n'}
              • Tous vos messages seront effacés{'\n'}
              • Tous vos médias seront supprimés{'\n'}
              • Cette action ne peut pas être annulée
            </Text>

            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.modalCancelButton}
                onPress={cancelDeleteAccount}
                disabled={isDeleting}
              >
                <Text style={styles.modalCancelText}>Annuler</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalDeleteButton, isDeleting && styles.modalDeleteButtonDisabled]}
                onPress={confirmDeleteAccount}
                disabled={isDeleting}
              >
                <Text style={styles.modalDeleteText}>
                  {isDeleting ? 'Suppression...' : 'Supprimer'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Report User Modal */}
      <ReportUserModal
        visible={showReportModal}
        onClose={() => setShowReportModal(false)}
        reportedUser={null} // No specific user for general reports
        currentUser={currentUser}
        allowUserSearch={true} // Enable search functionality
        onSubmit={handleReportSubmit}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.black,
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
    padding: Spacing.xs,
  },
  title: {
    fontSize: Typography.xl,
    fontWeight: Typography.light,
    color: Colors.white,
  },
  placeholder: {
    width: 40, // Same width as back button for centering
  },
  
  // Content
  scrollView: {
    flex: 1,
  },
  content: {
    padding: Spacing.screen,
    paddingBottom: Spacing.xl, // Extra padding at bottom for safe scrolling
  },
  
  // Sections
  section: {
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.light,
    color: Colors.gray400,
    marginBottom: Spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  
  // Setting Items
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    backgroundColor: Colors.gray900,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.gray800,
  },
  settingItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingItemText: {
    fontSize: Typography.base,
    fontWeight: Typography.light,
    color: Colors.white,
    marginLeft: Spacing.md,
  },
  versionText: {
    fontSize: Typography.base,
    fontWeight: Typography.light,
    color: Colors.gray400,
  },
  
  // Danger Section
  dangerSection: {
    marginTop: Spacing.xl,
    paddingTop: Spacing.xl,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.md,
    backgroundColor: Colors.fire,
    borderRadius: BorderRadius.lg,
  },
  deleteButtonText: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.white,
    marginLeft: Spacing.sm,
  },
  
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.blackOverlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.screen,
  },
  modalContent: {
    backgroundColor: Colors.gray900,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: Colors.gray800,
  },
  modalIcon: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  modalTitle: {
    fontSize: Typography.xl,
    fontWeight: Typography.medium,
    color: Colors.white,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  modalMessage: {
    fontSize: Typography.base,
    fontWeight: Typography.light,
    color: Colors.gray300,
    textAlign: 'center',
    marginBottom: Spacing.lg,
    lineHeight: 22,
  },
  modalWarning: {
    fontSize: Typography.sm,
    fontWeight: Typography.light,
    color: Colors.gray400,
    marginBottom: Spacing.xl,
    lineHeight: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  modalCancelButton: {
    flex: 1,
    padding: Spacing.md,
    backgroundColor: Colors.gray800,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.white,
  },
  modalDeleteButton: {
    flex: 1,
    padding: Spacing.md,
    backgroundColor: Colors.fire,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
  },
  modalDeleteButtonDisabled: {
    opacity: 0.6,
  },
  modalDeleteText: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.white,
  },
  settingItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  countBadge: {
    backgroundColor: Colors.fire,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.sm,
  },
  countText: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    color: Colors.white,
    textAlign: 'center',
  },
})

export default SettingsScreen
