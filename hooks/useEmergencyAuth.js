import { useState, useCallback } from 'react'
import { Alert } from 'react-native'
import { AuthHealthMonitor } from '../services/authHealthMonitor'
import { RobustDeviceAuthService } from '../services/robustDeviceAuthService'
import { useAuthContext } from '../context/AuthContext'

/**
 * Hook for emergency authentication recovery
 * Use this in components where users might get stuck without auth
 */
export const useEmergencyAuth = () => {
  const [isRecovering, setIsRecovering] = useState(false)
  const { login } = useAuthContext()

  const performEmergencyRecovery = useCallback(async () => {
    try {
      setIsRecovering(true)
      console.log('🚨 [EMERGENCY_AUTH] Starting emergency recovery...')
      
      // Show user that we're attempting recovery
      Alert.alert(
        'Récupération du compte',
        'Tentative de récupération automatique de votre compte...',
        [],
        { cancelable: false }
      )
      
      const recoveryResult = await AuthHealthMonitor.performEmergencyRecovery()
      
      if (recoveryResult?.user) {
        console.log('✅ [EMERGENCY_AUTH] Recovery successful')
        
        await login(recoveryResult.user, false)
        
        Alert.alert(
          'Compte récupéré !',
          `Votre compte ${recoveryResult.user.pseudo} a été récupéré avec succès.`,
          [{ text: 'Continuer' }]
        )
        
        return { success: true, user: recoveryResult.user }
      } else {
        console.log('❌ [EMERGENCY_AUTH] Recovery failed')
        
        Alert.alert(
          'Récupération impossible',
          'Impossible de récupérer automatiquement votre compte. Vous devrez peut-être créer un nouveau compte.',
          [
            { text: 'Créer nouveau compte', style: 'default' },
            { text: 'Réessayer plus tard', style: 'cancel' }
          ]
        )
        
        return { success: false }
      }
      
    } catch (error) {
      console.error('❌ [EMERGENCY_AUTH] Emergency recovery error:', error)
      
      Alert.alert(
        'Erreur de récupération',
        'Une erreur est survenue lors de la récupération. Veuillez réessayer.',
        [{ text: 'OK' }]
      )
      
      return { success: false, error }
    } finally {
      setIsRecovering(false)
    }
  }, [login])

  const showEmergencyRecoveryPrompt = useCallback(() => {
    Alert.alert(
      'Problème de connexion ?',
      'Il semble y avoir un problème avec votre authentification. Voulez-vous tenter une récupération automatique ?',
      [
        { text: 'Annuler', style: 'cancel' },
        { 
          text: 'Récupérer mon compte', 
          style: 'default',
          onPress: performEmergencyRecovery
        }
      ]
    )
  }, [performEmergencyRecovery])

  const checkAndPromptRecovery = useCallback(async () => {
    try {
      const currentUser = RobustDeviceAuthService.getCurrentUser()
      const authState = RobustDeviceAuthService.getCurrentAuthState()
      
      // Check if user seems to be in a bad state
      const needsRecovery = !currentUser || 
                           !authState?.isAuthenticated ||
                           authState?.needsAttention ||
                           authState?.isEmergencyRecovery
      
      if (needsRecovery) {
        console.log('⚠️ [EMERGENCY_AUTH] Auth state needs attention, prompting recovery')
        showEmergencyRecoveryPrompt()
        return true
      }
      
      return false
    } catch (error) {
      console.error('❌ [EMERGENCY_AUTH] Error checking recovery need:', error)
      return false
    }
  }, [showEmergencyRecoveryPrompt])

  const getHealthMetrics = useCallback(() => {
    return AuthHealthMonitor.getHealthMetrics()
  }, [])

  return {
    isRecovering,
    performEmergencyRecovery,
    showEmergencyRecoveryPrompt,
    checkAndPromptRecovery,
    getHealthMetrics
  }
}

export default useEmergencyAuth