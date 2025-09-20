/**
 * Test Notification Screen
 * Development screen to test push notifications functionality
 */

import React, { useState, useEffect } from 'react'
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Typography, Spacing, BorderRadius } from '../constants/Design'
import { useAuthContext } from '../context/AuthContext'
import { pushNotificationService, NotificationTypes } from '../services/pushNotificationService'
import { notificationIntegration } from '../services/notificationIntegration'

// Gracefully handle FCM service import
let fcmService = null
try {
  const fcmModule = require('../services/fcmService')
  fcmService = fcmModule.fcmService
} catch (error) {
  console.log('📱 [TEST] FCM service not available:', error.message)
}

const TestNotificationScreen = () => {
  const { user: currentUser } = useAuthContext()
  const [customTitle, setCustomTitle] = useState('')
  const [customBody, setCustomBody] = useState('')
  const [testResults, setTestResults] = useState([])
  const [pushToken, setPushToken] = useState(null)
  const [diagnostic, setDiagnostic] = useState(null)
  const [isRunningDiagnostic, setIsRunningDiagnostic] = useState(false)

  useEffect(() => {
    loadNotificationInfo()
  }, [])

  const loadNotificationInfo = async () => {
    try {
      const token = pushNotificationService.getPushToken()
      setPushToken(token)
    } catch (error) {
      console.error('Error loading notification info:', error)
    }
  }

  const addTestResult = (test, success, details = '') => {
    const result = {
      id: Date.now(),
      test,
      success,
      details,
      timestamp: new Date().toLocaleTimeString()
    }
    setTestResults(prev => [result, ...prev].slice(0, 10)) // Keep last 10 results
  }

  // Run comprehensive notification diagnostic
  const runDiagnostic = async () => {
    setIsRunningDiagnostic(true)
    try {
      const result = await pushNotificationService.runNotificationDiagnostic()
      
      // Also run FCM diagnostic if available
      let fcmResult = null
      if (fcmService) {
        fcmResult = await fcmService.runDiagnostic()
        result.fcm = fcmResult
      } else {
        result.fcm = {
          fcmAvailable: false,
          tokenGenerated: false,
          permissionGranted: false,
          issues: ['FCM service not available (running in Expo Go)']
        }
      }
      
      setDiagnostic(result)
      const fcmIssueCount = result.fcm.issues.length
      addTestResult(
        'Diagnostic système',
        result.issues.length === 0 && fcmIssueCount === 0,
        result.issues.length > 0 || fcmIssueCount > 0 
          ? `${result.issues.length + fcmIssueCount} problème(s) détecté(s)` 
          : 'Système sain'
      )
    } catch (error) {
      addTestResult('Diagnostic système', false, error.message)
    }
    setIsRunningDiagnostic(false)
  }

  const sendTestNotification = async (type) => {
    try {
      let title, body, data

      switch (type) {
        case 'simple':
          title = 'Test NoText'
          body = 'Ceci est une notification de test simple'
          data = { type: 'test', subtype: 'simple' }
          break
        case 'message':
          title = 'TestUser'
          body = '📷 Photo'
          data = { 
            type: NotificationTypes.MESSAGE,
            senderId: 'test-user-id',
            senderPseudo: 'TestUser',
            messageCount: 1
          }
          break
        case 'multiple':
          title = 'TestUser'
          body = '3 nouveaux messages'
          data = { 
            type: NotificationTypes.MESSAGE,
            senderId: 'test-user-id',
            senderPseudo: 'TestUser',
            messageCount: 3
          }
          break
        case 'custom':
          if (!customTitle.trim() || !customBody.trim()) {
            Alert.alert('Erreur', 'Veuillez remplir le titre et le corps du message')
            return
          }
          title = customTitle.trim()
          body = customBody.trim()
          data = { type: 'custom' }
          break
        default:
          return
      }

      console.log(`📱 [TEST] Sending ${type} notification...`)

      const notificationId = await pushNotificationService.queueNotification({
        userId: currentUser.id,
        title,
        body,
        data,
        priority: 'high',
        sound: true
      })

      addTestResult(
        `${type.charAt(0).toUpperCase() + type.slice(1)} Notification`,
        true,
        `ID: ${notificationId}`
      )

      Alert.alert('Succès', 'Notification envoyée avec succès!')

    } catch (error) {
      console.error(`❌ [TEST] Error sending ${type} notification:`, error)
      addTestResult(
        `${type.charAt(0).toUpperCase() + type.slice(1)} Notification`,
        false,
        error.message
      )
      Alert.alert('Erreur', `Impossible d'envoyer la notification: ${error.message}`)
    }
  }

  const testIntegrationFlow = async () => {
    try {
      // Simulate a message received event
      const mockMessage = {
        id: `test-${Date.now()}`,
        sender_id: 'test-sender-id',
        receiver_id: currentUser.id,
        sender_pseudo: 'TestSender',
        media_type: 'image',
        caption: 'Message de test!',
        view_once: false,
        created_at: new Date().toISOString()
      }

      console.log('📱 [TEST] Testing integration flow with mock message...')

      notificationIntegration.handleNewMessage({
        message: mockMessage,
        data: mockMessage
      })

      addTestResult(
        'Integration Flow',
        true,
        'Mock message processed through integration'
      )

      Alert.alert('Succès', 'Flux d\'intégration testé avec succès!')

    } catch (error) {
      console.error('❌ [TEST] Error testing integration flow:', error)
      addTestResult(
        'Integration Flow',
        false,
        error.message
      )
      Alert.alert('Erreur', `Erreur lors du test d'intégration: ${error.message}`)
    }
  }

  const clearNotifications = async () => {
    try {
      await pushNotificationService.clearAllNotifications()
      addTestResult('Clear Notifications', true, 'All notifications cleared')
      Alert.alert('Succès', 'Toutes les notifications ont été supprimées')
    } catch (error) {
      console.error('❌ [TEST] Error clearing notifications:', error)
      addTestResult('Clear Notifications', false, error.message)
      Alert.alert('Erreur', `Impossible de supprimer les notifications: ${error.message}`)
    }
  }

  const TestButton = ({ title, onPress, icon, color = Colors.accent }) => (
    <TouchableOpacity onPress={onPress} style={[styles.testButton, { backgroundColor: color }]}>
      <Ionicons name={icon} size={20} color={Colors.white} />
      <Text style={styles.testButtonText}>{title}</Text>
    </TouchableOpacity>
  )

  const ResultItem = ({ result }) => (
    <View style={[styles.resultItem, { borderLeftColor: result.success ? Colors.success : Colors.error }]}>
      <View style={styles.resultHeader}>
        <Text style={styles.resultTest}>{result.test}</Text>
        <Text style={styles.resultTime}>{result.timestamp}</Text>
      </View>
      <View style={styles.resultStatus}>
        <Ionicons 
          name={result.success ? 'checkmark-circle' : 'close-circle'} 
          size={16} 
          color={result.success ? Colors.success : Colors.error} 
        />
        <Text style={[
          styles.resultStatusText,
          { color: result.success ? Colors.success : Colors.error }
        ]}>
          {result.success ? 'Succès' : 'Échec'}
        </Text>
      </View>
      {result.details && <Text style={styles.resultDetails}>{result.details}</Text>}
    </View>
  )

  if (!currentUser) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Vous devez être connecté pour tester les notifications</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Test des Notifications</Text>
        <Text style={styles.subtitle}>Écran de test pour les notifications push</Text>
      </View>

      {/* Info Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Informations</Text>
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>Utilisateur:</Text>
          <Text style={styles.infoValue}>{currentUser.pseudo}</Text>
        </View>
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>Push Token:</Text>
          <Text style={styles.infoValue} numberOfLines={2}>
            {pushToken ? `${pushToken.substring(0, 40)}...` : 'Non disponible'}
          </Text>
        </View>
      </View>

      {/* Test Buttons */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Tests Rapides</Text>
        
        <TestButton
          title="🔍 Diagnostic Système"
          onPress={runDiagnostic}
          icon="analytics-outline"
          color="#8b5cf6"
        />
        
        <TestButton
          title="Notification Simple"
          onPress={() => sendTestNotification('simple')}
          icon="notifications-outline"
        />
        
        <TestButton
          title="Notification Message"
          onPress={() => sendTestNotification('message')}
          icon="chatbubble-outline"
        />
        
        <TestButton
          title="Messages Multiples"
          onPress={() => sendTestNotification('multiple')}
          icon="chatbubbles-outline"
        />
        
        <TestButton
          title="Test Intégration"
          onPress={testIntegrationFlow}
          icon="link-outline"
          color={Colors.warning}
        />
        
        <TestButton
          title="Supprimer Notifications"
          onPress={clearNotifications}
          icon="trash-outline"
          color={Colors.error}
        />
      </View>

      {/* Custom Notification */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notification Personnalisée</Text>
        
        <TextInput
          style={styles.input}
          placeholder="Titre de la notification"
          placeholderTextColor={Colors.textSecondary}
          value={customTitle}
          onChangeText={setCustomTitle}
        />
        
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Corps du message"
          placeholderTextColor={Colors.textSecondary}
          value={customBody}
          onChangeText={setCustomBody}
          multiline
          numberOfLines={3}
        />
        
        <TestButton
          title="Envoyer Personnalisée"
          onPress={() => sendTestNotification('custom')}
          icon="send-outline"
          color={Colors.primary}
        />
      </View>

      {/* Test Results */}
      {testResults.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Résultats des Tests</Text>
          {testResults.map(result => (
            <ResultItem key={result.id} result={result} />
          ))}
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    padding: Spacing.lg,
    alignItems: 'center',
  },
  title: {
    ...Typography.h2,
    color: Colors.text,
    textAlign: 'center',
  },
  subtitle: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    ...Typography.h3,
    color: Colors.text,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  infoLabel: {
    ...Typography.body,
    color: Colors.textSecondary,
    width: 100,
  },
  infoValue: {
    ...Typography.body,
    color: Colors.text,
    flex: 1,
    fontFamily: 'monospace',
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  testButtonText: {
    ...Typography.body,
    color: Colors.white,
    fontWeight: '600',
  },
  input: {
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    color: Colors.text,
    ...Typography.body,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  resultItem: {
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderLeftWidth: 4,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  resultTest: {
    ...Typography.body,
    color: Colors.text,
    fontWeight: '600',
  },
  resultTime: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  resultStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  resultStatusText: {
    ...Typography.caption,
    fontWeight: '600',
  },
  resultDetails: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontFamily: 'monospace',
  },
  errorText: {
    ...Typography.body,
    color: Colors.error,
    textAlign: 'center',
    margin: Spacing.xl,
  },
})

export default TestNotificationScreen
