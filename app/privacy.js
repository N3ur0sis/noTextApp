import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import {
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native'
import { BorderRadius, Colors, Spacing, Typography } from '../constants/Design'
import { getSafeAreaTop } from '../utils/responsive'

const PrivacyScreen = () => {
  const handleGoBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.back()
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
        <Text style={styles.title}>Confidentialité</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Content */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Privacy Info */}
        <View style={styles.infoSection}>
          <View style={styles.infoIcon}>
            <Ionicons name="shield-checkmark" size={24} color={Colors.success} />
          </View>
          <Text style={styles.infoTitle}>Protection de vos données</Text>
          <Text style={styles.infoDescription}>
            NoText est une application de messagerie visuelle axée sur la confidentialité. Vos conversations 
            restent privées et nous respectons votre vie privée. Vos médias sont protégés 
            par authentification et liens temporaires.
          </Text>
        </View>

        {/* Important Notice */}
        <View style={styles.warningSection}>
          <View style={styles.warningIcon}>
            <Ionicons name="information-circle" size={24} color={Colors.warning} />
          </View>
          <Text style={styles.warningTitle}>Information importante</Text>
          <Text style={styles.warningDescription}>
            Les communications ne sont pas chiffrées de bout en bout. Les médias sont 
            protégés par authentification et accès temporaire, mais restent accessibles 
            au personnel habilité en cas de signalement ou pour des raisons légales.
          </Text>
        </View>

        {/* Data Security */}
        <View style={styles.securitySection}>
          <Text style={styles.sectionTitle}>Sécurité et données</Text>
          
          <View style={styles.securityItem}>
            <View style={styles.securityIcon}>
              <Ionicons name="server" size={20} color={Colors.warning} />
            </View>
            <View style={styles.securityContent}>
              <Text style={styles.securityTitle}>Stockage sécurisé</Text>
              <Text style={styles.securityDescription}>
                Vos médias sont stockés de manière sécurisée et ne sont accessibles qu&apos;aux destinataires autorisés et, si nécessaire, au personnel habilité (signalement ou obligations légales).
              </Text>
            </View>
          </View>

          <View style={styles.securityItem}>
            <View style={styles.securityIcon}>
              <Ionicons name="trash" size={20} color={Colors.fire} />
            </View>
            <View style={styles.securityContent}>
              <Text style={styles.securityTitle}>Médias éphémères</Text>
              <Text style={styles.securityDescription}>
                Les médias temporaires sont automatiquement supprimés selon les règles 
                choisies (vue unique, temporaire) pour protéger votre vie privée.
              </Text>
            </View>
          </View>

          <View style={styles.securityItem}>
            <View style={styles.securityIcon}>
              <Ionicons name="notifications" size={20} color={Colors.white} />
            </View>
            <View style={styles.securityContent}>
              <Text style={styles.securityTitle}>Notifications</Text>
              <Text style={styles.securityDescription}>
                Recevez des notifications push pour les nouveaux messages. Vous pouvez les désactiver dans les paramètres de votre appareil.
              </Text>
            </View>
          </View>
        </View>

        {/* Privacy Tips */}
        <View style={styles.tipsSection}>
          <Text style={styles.sectionTitle}>Conseils de sécurité</Text>
          
          <View style={styles.tipItem}>
            <Ionicons name="bulb" size={16} color={Colors.warning} />
            <Text style={styles.tipText}>
              Ne partagez jamais vos informations de connexion
            </Text>
          </View>
          
          <View style={styles.tipItem}>
            <Ionicons name="bulb" size={16} color={Colors.warning} />
            <Text style={styles.tipText}>
              Signalez tout comportement inapproprié
            </Text>
          </View>
          
          <View style={styles.tipItem}>
            <Ionicons name="bulb" size={16} color={Colors.warning} />
            <Text style={styles.tipText}>
              Les messages supprimés ne peuvent pas être récupérés
            </Text>
          </View>
          
          <View style={styles.tipItem}>
            <Ionicons name="bulb" size={16} color={Colors.warning} />
            <Text style={styles.tipText}>
              Capture d'écran : il est techniquement possible de capturer l'écran ; soyez prudent
            </Text>
          </View>
        </View>
      </ScrollView>
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
    width: 40,
  },
  
  // Content
  content: {
    flex: 1,
    padding: Spacing.screen,
  },
  
  // Info Section
  infoSection: {
    backgroundColor: Colors.gray900,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.gray800,
  },
  infoIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: Colors.success + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  infoTitle: {
    fontSize: Typography.lg,
    fontWeight: Typography.medium,
    color: Colors.white,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  infoDescription: {
    fontSize: Typography.base,
    color: Colors.gray400,
    textAlign: 'center',
    lineHeight: 22,
  },
  
  // Warning Section
  warningSection: {
    backgroundColor: Colors.warning + '10',
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.warning + '30',
  },
  warningIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: Colors.warning + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  warningTitle: {
    fontSize: Typography.lg,
    fontWeight: Typography.medium,
    color: Colors.warning,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  warningDescription: {
    fontSize: Typography.base,
    color: Colors.gray300,
    textAlign: 'center',
    lineHeight: 22,
  },
  
  // Settings Section
  settingsSection: {
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.white,
    marginBottom: Spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.gray900,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.gray800,
  },
  settingItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingIcon: {
    width: 35,
    height: 35,
    borderRadius: 17.5,
    backgroundColor: Colors.gray800,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  settingContent: {
    flex: 1,
  },
  settingTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.white,
    marginBottom: Spacing.xs,
  },
  settingDescription: {
    fontSize: Typography.sm,
    color: Colors.gray400,
    lineHeight: 18,
  },
  
  // Security Section
  securitySection: {
    marginBottom: Spacing.xl,
  },
  securityItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.gray900,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.gray800,
  },
  securityIcon: {
    width: 35,
    height: 35,
    borderRadius: 17.5,
    backgroundColor: Colors.gray800,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  securityContent: {
    flex: 1,
  },
  securityTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.white,
    marginBottom: Spacing.xs,
  },
  securityDescription: {
    fontSize: Typography.sm,
    color: Colors.gray400,
    lineHeight: 18,
  },
  
  // Tips Section
  tipsSection: {
    marginBottom: Spacing.xl,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.gray900,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.gray800,
  },
  tipText: {
    fontSize: Typography.sm,
    color: Colors.gray300,
    marginLeft: Spacing.sm,
    lineHeight: 18,
    flex: 1,
  },
})

export default PrivacyScreen
