import { Ionicons } from '@expo/vector-icons'
import Constants from 'expo-constants'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useState } from 'react'
import {
    Linking,
    Platform,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native'
import { BorderRadius, Colors, Spacing, Typography } from '../constants/Design'
import { getSafeAreaTop } from '../utils/responsive'

const HelpScreen = () => {
  const [expandedFAQ, setExpandedFAQ] = useState(null)

  const handleGoBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.back()
  }

  const handleEmailPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    Linking.openURL('mailto:contact@solodesign.fr?subject=NoText Support')
  }

  const toggleFAQ = (index) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setExpandedFAQ(expandedFAQ === index ? null : index)
  }

  const faqData = [
    {
      question: "Comment créer mon compte ?",
      answer: "Choisissez simplement un pseudo unique, indiquez votre âge (18+ requis) et votre sexe. Aucun mot de passe ou email n'est nécessaire. Votre pseudo agit comme votre identité unique."
    },
    {
      question: "Comment commencer une conversation ?",
      answer: "Recherchez un pseudo dans la barre de recherche et appuyez dessus. Cela ouvrira directement la caméra pour envoyer votre première photo ou vidéo. NoText est 100% visuel - aucun texte n'est échangé."
    },
    {
      question: "Quels sont les trois types de médias ?",
      answer: "• ♾️ Permanent : peut être revu à volonté, reste dans l'historique\n• 👁️ Vue unique : ne peut être vu qu'une seule fois puis devient flouté\n• 🔥 Éphémère : contenu avec timer automatique, supprimé après visualisation"
    },
    {
      question: "Comment fonctionne le mode 🔥 Éphémère ?",
      answer: "Les médias éphémères ont un timer automatique (5s pour photos, durée vidéo pour vidéos). Une barre de progression s'affiche pendant la visualisation. Une fois le temps écoulé, le contenu est définitivement supprimé et masqué."
    },
    {
      question: "Qu'est-ce que le mode 👁️ vue unique ?",
      answer: "Les médias vue unique peuvent être vus une seule fois. Après visualisation, ils deviennent floutés avec une icône 🔒 mais restent visibles dans l'historique comme 'déjà vu'."
    },
    {
      question: "Qu'est-ce que le mode ♾️ permanent ?",
      answer: "Les médias permanents peuvent être revus à volonté. Ils restent accessibles dans l'historique de votre conversation pour être appréciés à nouveau sans restriction."
    },
    {
      question: "Comment naviguer dans l'application ?",
      answer: "• Swipe gauche/droite : naviguer dans l'historique des médias\n• Swipe haut : ouvrir la caméra\n• Swipe bas : revenir à l'accueil\n• Interface intuitive inspirée des stories"
    },
    {
      question: "Mes données sont-elles sécurisées ?",
      answer: "Vos médias sont stockés de manière sécurisée avec des URLs temporaires. Les contenus 👁️ deviennent floutés après vue, les contenus 🔥 Éphémère sont automatiquement supprimés après le timer. Cependant, aucun chiffrement de bout en bout n'est implémenté."
    },
    {
      question: "Que se passe-t-il si je me déconnecte ?",
      answer: "ATTENTION : Si vous quittez l'app, toutes vos conversations seront définitivement supprimées et votre pseudo redeviendra disponible. Un seul appareil peut être connecté par pseudo."
    },
    {
      question: "Comment signaler un contenu inapproprié ?",
      answer: "Contactez-nous directement par email à contact@solodesign.fr ou via l'option Signaler dans l'application. Nous prenons très au sérieux les signalements de contenus non consensuels ou illégaux."
    },
    {
      question: "Que se passe-t-il avec les médias éphémères expirés ?",
      answer: "Une fois le timer écoulé, les médias 🔥 Éphémère sont définitivement supprimés et remplacés par un message 'Contenu masqué' avec l'icône 👁️‍🗨️. Ils ne peuvent plus être récupérés."
    },
    {
      question: "L'application sauvegarde-t-elle mes photos ?",
      answer: "Non, aucun média n'est sauvegardé dans votre galerie. Tout reste dans l'application pour préserver votre intimité et votre discrétion."
    },
    {
      question: "Pourquoi l'app demande-t-elle des permissions ?",
      answer: "• Caméra : pour capturer photos et vidéos\n• Notifications : pour vous alerter de nouveaux médias reçus\n• Aucun accès à vos contacts ou galerie n'est requis"
    }
  ]

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
        <Text style={styles.title}>Aide & Contact</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Content */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Help Info */}
        <View style={styles.infoSection}>
          <View style={styles.infoIcon}>
            <Ionicons name="help-circle" size={24} color={Colors.white} />
          </View>
          <Text style={styles.infoTitle}>Bienvenue sur NoText</Text>
          <Text style={styles.infoDescription}>
            Une application de messagerie visuelle moderne, axée sur la confidentialité. Échangez exclusivement photos et vidéos dans une interface épurée et intuitive. Communication 100% visuelle, sans texte.
          </Text>
        </View>

        {/* FAQ Section */}
        <View style={styles.faqSection}>
          <Text style={styles.sectionTitle}>Questions fréquentes</Text>
          
          {faqData.map((item, index) => (
            <View key={index} style={styles.faqItem}>
              <TouchableOpacity
                style={styles.faqQuestion}
                onPress={() => toggleFAQ(index)}
                activeOpacity={0.8}
              >
                <Text style={styles.questionText}>{item.question}</Text>
                <Ionicons
                  name={expandedFAQ === index ? "chevron-up" : "chevron-down"}
                  size={20}
                  color={Colors.gray400}
                />
              </TouchableOpacity>
              
              {expandedFAQ === index && (
                <View style={styles.faqAnswer}>
                  <Text style={styles.answerText}>{item.answer}</Text>
                </View>
              )}
            </View>
          ))}
        </View>

        {/* Contact Section */}
        <View style={styles.contactSection}>
          <Text style={styles.sectionTitle}>Contact</Text>
          
          <View style={styles.contactItem}>
            <View style={styles.contactIcon}>
              <Ionicons name="mail" size={20} color={Colors.primary} />
            </View>
            <View style={styles.contactContent}>
              <Text style={styles.contactTitle}>Email de support</Text>
              <Text style={styles.contactDescription}>
                Pour toute question, problème technique ou signalement, contactez-nous directement par email :
              </Text>
              <TouchableOpacity onPress={handleEmailPress} activeOpacity={0.8}>
                <Text style={[styles.contactDescription, { color: Colors.primary, fontWeight: 'bold', marginTop: 4, textDecorationLine: 'underline' }]}>
                  contact@solodesign.fr
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.contactItem}>
            <View style={styles.contactIcon}>
              <Ionicons name="star" size={20} color={Colors.warning} />
            </View>
            <View style={styles.contactContent}>
              <Text style={styles.contactTitle}>Évaluer l'application</Text>
              <Text style={styles.contactDescription}>
                Si vous aimez l'application, n'hésitez pas à laisser une note positive ! 
                Cela nous aide énormément à faire connaître l'app.
              </Text>
            </View>
          </View>
        </View>

        {/* Quick Actions */}
        <View style={styles.actionsSection}>
          <Text style={styles.sectionTitle}>Actions rapides</Text>
          
          <View style={styles.actionItem}>
            <View style={styles.actionIcon}>
              <Ionicons name="refresh" size={20} color={Colors.white} />
            </View>
            <View style={styles.actionContent}>
              <Text style={styles.actionTitle}>Redémarrer l'application</Text>
              <Text style={styles.actionDescription}>
                Si vous rencontrez des problèmes, essayez de fermer complètement l'app et de la relancer.
              </Text>
            </View>
          </View>

          <View style={styles.actionItem}>
            <View style={styles.actionIcon}>
              <Ionicons name="download" size={20} color={Colors.success} />
            </View>
            <View style={styles.actionContent}>
              <Text style={styles.actionTitle}>Vérifier les mises à jour</Text>
              <Text style={styles.actionDescription}>
                Assurez-vous d'avoir la dernière version de l'application pour bénéficier de toutes les fonctionnalités.
              </Text>
            </View>
          </View>

          <View style={styles.actionItem}>
            <View style={styles.actionIcon}>
              <Ionicons name="settings" size={20} color={Colors.gray400} />
            </View>
            <View style={styles.actionContent}>
              <Text style={styles.actionTitle}>Vérifier les permissions</Text>
              <Text style={styles.actionDescription}>
                Assurez-vous que l'application a les permissions nécessaires pour la caméra et les notifications.
              </Text>
            </View>
          </View>
        </View>

        {/* App Info */}
        <View style={styles.appInfoSection}>
          <Text style={styles.sectionTitle}>Informations de l'application</Text>
          
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Version</Text>
            <Text style={styles.infoValue}>{Constants.expoConfig?.version || '1.0.0'}</Text>
          </View>
          
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Plateforme</Text>
            <Text style={styles.infoValue}>
              {Platform.OS === 'ios' ? 'iOS' : 'Android'} / React Native / Expo
            </Text>
          </View>
          
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Type</Text>
            <Text style={styles.infoValue}>Messagerie visuelle sécurisée</Text>
          </View>
          
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Dernière mise à jour</Text>
            <Text style={styles.infoValue}>Juillet 2025</Text>
          </View>
          
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Support & Contact</Text>
            <TouchableOpacity onPress={handleEmailPress}>
              <Text style={[styles.infoValue, { color: Colors.primary, textDecorationLine: 'underline' }]}>
                contact@solodesign.fr
              </Text>
            </TouchableOpacity>
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
    backgroundColor: Colors.white + '20',
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
  
  // FAQ Section
  faqSection: {
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
  faqItem: {
    backgroundColor: Colors.gray900,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.gray800,
    overflow: 'hidden',
  },
  faqQuestion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
  },
  questionText: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.white,
    flex: 1,
    marginRight: Spacing.sm,
  },
  faqAnswer: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.gray800,
  },
  answerText: {
    fontSize: Typography.sm,
    color: Colors.gray300,
    lineHeight: 20,
    marginTop: Spacing.sm,
  },
  
  // Contact Section
  contactSection: {
    marginBottom: Spacing.xl,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.gray900,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.gray800,
  },
  contactIcon: {
    width: 35,
    height: 35,
    borderRadius: 17.5,
    backgroundColor: Colors.gray800,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  contactContent: {
    flex: 1,
  },
  contactTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.white,
    marginBottom: Spacing.xs,
  },
  contactDescription: {
    fontSize: Typography.sm,
    color: Colors.gray400,
    lineHeight: 18,
  },
  
  // Actions Section
  actionsSection: {
    marginBottom: Spacing.xl,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.gray900,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.gray800,
  },
  actionIcon: {
    width: 35,
    height: 35,
    borderRadius: 17.5,
    backgroundColor: Colors.gray800,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  actionContent: {
    flex: 1,
  },
  actionTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.white,
    marginBottom: Spacing.xs,
  },
  actionDescription: {
    fontSize: Typography.sm,
    color: Colors.gray400,
    lineHeight: 18,
  },
  
  // App Info Section
  appInfoSection: {
    marginBottom: Spacing.xl,
  },
  infoRow: {
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
  infoLabel: {
    fontSize: Typography.base,
    color: Colors.gray400,
  },
  infoValue: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.white,
  },
})

export default HelpScreen
