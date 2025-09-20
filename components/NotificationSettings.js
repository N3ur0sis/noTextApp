/**
 * Notification Settings Component
 * Allows users to manage their push notification preferences
 */

import React, { useEffect, useState } from 'react'
import {
  Alert,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Typography, Spacing, BorderRadius } from '../constants/Design'
import { notificationIntegration } from '../services/notificationIntegration'
import { pushNotificationService } from '../services/pushNotificationService'

const NotificationSettings = () => {
  const [settings, setSettings] = useState({
    messages: true,
    sounds: true,
    vibration: true,
    badges: true
  })
  const [permissionStatus, setPermissionStatus] = useState('undetermined')
  const [pushToken, setPushToken] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      setLoading(true)
      
      // Load current settings
      const currentSettings = notificationIntegration.getNotificationSettings()
      if (currentSettings) {
        setSettings(currentSettings)
      }

      // Check permission status
      const status = await pushNotificationService.getPermissionStatus()
      setPermissionStatus(status)

      // Get push token
      const token = pushNotificationService.getPushToken()
      setPushToken(token)

    } catch (error) {
      console.error('❌ [NOTIF_SETTINGS] Error loading settings:', error)
    } finally {
      setLoading(false)
    }
  }

  const updateSetting = async (key, value) => {
    try {
      const newSettings = { ...settings, [key]: value }
      setSettings(newSettings)
      
      await notificationIntegration.updateNotificationSettings(newSettings)
      console.log(`📱 [NOTIF_SETTINGS] Updated ${key} to ${value}`)
      
    } catch (error) {
      console.error('❌ [NOTIF_SETTINGS] Error updating setting:', error)
      Alert.alert('Erreur', 'Impossible de mettre à jour les paramètres')
    }
  }

  const requestPermissions = async () => {
    try {
      const granted = await pushNotificationService.requestPermissions()
      if (granted) {
        setPermissionStatus('granted')
        Alert.alert('Succès', 'Notifications activées avec succès!')
        await loadSettings() // Reload to get push token
      } else {
        Alert.alert(
          'Permissions refusées', 
          'Vous pouvez activer les notifications dans les paramètres de votre appareil.'
        )
      }
    } catch (error) {
      console.error('❌ [NOTIF_SETTINGS] Error requesting permissions:', error)
      Alert.alert('Erreur', 'Impossible de demander les permissions')
    }
  }

  const sendTestNotification = async () => {
    try {
      await notificationIntegration.sendTestNotification()
      Alert.alert('Test envoyé', 'Une notification de test a été envoyée!')
    } catch (error) {
      console.error('❌ [NOTIF_SETTINGS] Error sending test notification:', error)
      Alert.alert('Erreur', 'Impossible d\'envoyer la notification de test')
    }
  }

  const SettingRow = ({ title, description, value, onValueChange, icon }) => (
    <View style={styles.settingRow}>
      <View style={styles.settingLeft}>
        <Ionicons name={icon} size={24} color={Colors.text} style={styles.settingIcon} />
        <View style={styles.settingText}>
          <Text style={styles.settingTitle}>{title}</Text>
          {description && <Text style={styles.settingDescription}>{description}</Text>}
        </View>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: Colors.border, true: Colors.accent }}
        thumbColor={value ? Colors.white : Colors.textSecondary}
      />
    </View>
  )

  const StatusRow = ({ title, status, onPress, icon, showButton = false }) => (
    <View style={styles.statusRow}>
      <View style={styles.settingLeft}>
        <Ionicons name={icon} size={24} color={Colors.text} style={styles.settingIcon} />
        <View style={styles.settingText}>
          <Text style={styles.settingTitle}>{title}</Text>
          <Text style={[
            styles.statusText,
            { color: status === 'granted' ? Colors.success : Colors.error }
          ]}>
            {getStatusText(status)}
          </Text>
        </View>
      </View>
      {showButton && status !== 'granted' && (
        <TouchableOpacity onPress={onPress} style={styles.actionButton}>
          <Text style={styles.actionButtonText}>Activer</Text>
        </TouchableOpacity>
      )}
    </View>
  )

  const getStatusText = (status) => {
    switch (status) {
      case 'granted': return 'Activées'
      case 'denied': return 'Refusées'
      case 'undetermined': return 'Non configurées'
      default: return 'Inconnue'
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Chargement des paramètres...</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>État des notifications</Text>
      
      <StatusRow
        title="Permissions système"
        status={permissionStatus}
        onPress={requestPermissions}
        icon="notifications-outline"
        showButton={true}
      />

      {pushToken && (
        <View style={styles.infoRow}>
          <Ionicons name="checkmark-circle" size={24} color={Colors.success} style={styles.settingIcon} />
          <Text style={styles.infoText}>Appareil enregistré pour les notifications</Text>
        </View>
      )}

      {permissionStatus === 'granted' && (
        <>
          <Text style={styles.sectionTitle}>Préférences</Text>
          
          <SettingRow
            title="Messages"
            description="Recevoir des notifications pour les nouveaux messages"
            value={settings.messages}
            onValueChange={(value) => updateSetting('messages', value)}
            icon="chatbubble-outline"
          />

          <SettingRow
            title="Sons"
            description="Jouer un son lors de la réception"
            value={settings.sounds}
            onValueChange={(value) => updateSetting('sounds', value)}
            icon="volume-high-outline"
          />

          <SettingRow
            title="Vibration"
            description="Vibrer lors de la réception"
            value={settings.vibration}
            onValueChange={(value) => updateSetting('vibration', value)}
            icon="phone-portrait-outline"
          />

          <SettingRow
            title="Badge"
            description="Afficher le nombre de messages non lus"
            value={settings.badges}
            onValueChange={(value) => updateSetting('badges', value)}
            icon="radio-button-on-outline"
          />

          <TouchableOpacity onPress={sendTestNotification} style={styles.testButton}>
            <Ionicons name="send-outline" size={20} color={Colors.white} />
            <Text style={styles.testButtonText}>Envoyer une notification de test</Text>
          </TouchableOpacity>
        </>
      )}

      {permissionStatus === 'denied' && (
        <View style={styles.deniedContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.error} />
          <Text style={styles.deniedTitle}>Notifications désactivées</Text>
          <Text style={styles.deniedText}>
            Les notifications sont désactivées pour cette application. 
            Vous pouvez les activer dans les paramètres de votre appareil.
          </Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  sectionTitle: {
    ...Typography.h3,
    color: Colors.text,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xl,
    marginBottom: Spacing.md,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingIcon: {
    marginRight: Spacing.md,
  },
  settingText: {
    flex: 1,
  },
  settingTitle: {
    ...Typography.body,
    color: Colors.text,
    fontWeight: '600',
  },
  settingDescription: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  statusText: {
    ...Typography.caption,
    fontWeight: '600',
    marginTop: 2,
  },
  actionButton: {
    backgroundColor: Colors.accent,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  actionButtonText: {
    ...Typography.caption,
    color: Colors.white,
    fontWeight: '600',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  infoText: {
    ...Typography.body,
    color: Colors.success,
    fontWeight: '500',
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  testButtonText: {
    ...Typography.body,
    color: Colors.white,
    fontWeight: '600',
  },
  deniedContainer: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xl,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xl,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
  },
  deniedTitle: {
    ...Typography.h3,
    color: Colors.error,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  deniedText: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  loadingText: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.xl,
  },
})

export default NotificationSettings
