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

const CGUScreen = () => {
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
        <Text style={styles.title}>CGU</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Content */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header Info */}
        <View style={styles.infoSection}>
          <Text style={styles.appName}>NoText - Conditions Générales d'Utilisation</Text>
          <Text style={styles.lastUpdated}>Dernière mise à jour : Juillet 2025</Text>
        </View>

        {/* Terms Content */}
        <View style={styles.termsSection}>
          
          {/* 1. Acceptation des Conditions */}
          <View style={styles.termBlock}>
            <Text style={styles.termTitle}>1. Acceptation des Conditions</Text>
            <Text style={styles.termText}>
              En utilisant NoText, une application de partage visuel anonyme, vous acceptez d'être lié par ces Conditions Générales d'Utilisation (CGU). 
              Si vous n'acceptez pas ces conditions, veuillez ne pas utiliser l'application.
            </Text>
          </View>

          {/* 2. Description du Service */}
          <View style={styles.termBlock}>
            <Text style={styles.termTitle}>2. Description du Service</Text>
            <Text style={styles.termText}>
              NoText est une application mobile de messagerie visuelle permettant aux utilisateurs majeurs 
              d'échanger exclusivement des photos et vidéos de manière privée et personnalisée. 
              L'application propose différents modes de partage : permanent, temporaire, et éphémère.
              Le service est destiné exclusivement aux personnes âgées de 18 ans et plus.
            </Text>
          </View>

          {/* 3. Âge et Éligibilité */}
          <View style={styles.termBlock}>
            <Text style={styles.termTitle}>3. Âge et Éligibilité</Text>
            <Text style={styles.termText}>
              Vous devez avoir au moins 18 ans pour utiliser cette application. En créant un compte avec votre pseudo unique, 
              vous certifiez que vous êtes majeur et que vous avez le droit légal de conclure cet accord dans votre juridiction. 
              L'application contient du contenu généré par les utilisateurs qui peut inclure des éléments sensibles.
            </Text>
          </View>

          {/* 4. Nature du Contenu */}
          <View style={styles.termBlock}>
            <Text style={styles.termTitle}>4. Contenu et Responsabilité</Text>
            <Text style={styles.termText}>
              Cette application facilite le partage de contenus visuels personnels entre adultes consentants. 
              L'application peut contenir du contenu généré par les utilisateurs de nature variée. 
              En utilisant l'application, vous reconnaissez que vous pourriez être exposé à divers types de contenu. 
              L'utilisation se fait entièrement à vos propres risques et sous votre responsabilité.
            </Text>
          </View>

          {/* 5. Utilisation Appropriée et Interdictions */}
          <View style={styles.termBlock}>
            <Text style={styles.termTitle}>5. Utilisation Appropriée et Interdictions</Text>
            <Text style={[styles.termText, { fontWeight: 'bold', color: Colors.fire, marginBottom: 10 }]}>
              POLITIQUE DE TOLÉRANCE ZÉRO : Nous maintenons une politique de tolérance zéro pour tout contenu inapproprié, harcèlement, ou comportement abusif. Tout utilisateur violant ces règles sera immédiatement suspendu ou banni définitivement.
            </Text>
            <Text style={styles.termText}>
              Vous vous engagez à :
              {'\n'}• Ne partager que du contenu dont vous détenez tous les droits
              {'\n'}• Ne pas harceler, menacer ou intimider d'autres utilisateurs
              {'\n'}• Ne pas partager de contenu illégal, violent ou sexuellement explicite
              {'\n'}• Ne pas partager de contenu impliquant des mineurs
              {'\n'}• Respecter la vie privée et l'anonymat des autres utilisateurs
              {'\n'}• Ne pas utiliser l'application à des fins commerciales non autorisées
              {'\n'}• Ne pas tenter de contourner les mesures de sécurité de l'application
              {'\n'}• Ne pas capturer, enregistrer ou redistribuer le contenu d'autres utilisateurs
              {'\n'}• Signaler tout contenu inapproprié aux modérateurs
            </Text>
          </View>

          {/* 6. Sécurité et Confidentialité des Données */}
          <View style={styles.termBlock}>
            <Text style={styles.termTitle}>6. Sécurité et Confidentialité des Données</Text>
            <Text style={styles.termText}>
              Nous mettons en place des mesures de sécurité pour protéger vos données et contenus. Les médias sont stockés 
              avec des URLs temporaires sécurisées, et les contenus marqués comme "vue unique" sont automatiquement supprimés 
              après visualisation. Cependant, nous n'implémentons pas de chiffrement de bout en bout. 
              Bien que nous nous efforcions de maintenir la sécurité, nous ne pouvons garantir une protection absolue 
              contre tous les types d'accès non autorisé ou de failles de sécurité.
            </Text>
          </View>

          {/* 7. Propriété Intellectuelle et Droits sur le Contenu */}
          <View style={styles.termBlock}>
            <Text style={styles.termTitle}>7. Propriété Intellectuelle et Droits sur le Contenu</Text>
            <Text style={styles.termText}>
              Vous conservez tous les droits sur le contenu que vous partagez. En utilisant l'application, vous nous accordez 
              une licence limitée et technique pour traiter, stocker et transmettre votre contenu uniquement dans le but de fournir le service. 
              Cette licence ne nous donne aucun droit de propriété ou d'exploitation commerciale de votre contenu.
            </Text>
          </View>

          {/* 8. Limitation de Responsabilité */}
          <View style={styles.termBlock}>
            <Text style={styles.termTitle}>8. Limitation de Responsabilité</Text>
            <Text style={styles.termText}>
              L'application est fournie "en l'état" sans garantie d'aucune sorte. Nous ne sommes pas responsables des dommages 
              directs, indirects, accessoires ou consécutifs résultant de l'utilisation de l'application, y compris mais sans s'y limiter :
              {'\n'}• La perte, le vol ou la diffusion non autorisée de contenu
              {'\n'}• Les interactions entre utilisateurs
              {'\n'}• Les conséquences émotionnelles ou psychologiques de l'utilisation
              {'\n'}• Les violations de confidentialité par des tiers
              {'\n'}Vous utilisez l'application entièrement à vos propres risques.
            </Text>
          </View>

          {/* 9. Anonymat et Pseudonymes */}
          <View style={styles.termBlock}>
            <Text style={styles.termTitle}>9. Anonymat et Pseudonymes</Text>
            <Text style={styles.termText}>
              L'application fonctionne sur le principe de l'anonymat via des pseudonymes uniques. Aucune authentification classique 
              n'est requise. ATTENTION : Si vous vous déconnectez ou désinstallez l'application, toutes vos conversations seront 
              définitivement supprimées et votre pseudo redeviendra disponible. Un seul appareil peut être connecté par pseudo à la fois.
            </Text>
          </View>

          {/* 10. Modération et Sanctions */}
          <View style={styles.termBlock}>
            <Text style={styles.termTitle}>10. Modération et Sanctions</Text>
            <Text style={styles.termText}>
              Nous nous réservons le droit de suspendre ou de supprimer des comptes qui violent ces conditions. 
              Les utilisateurs peuvent signaler un contenu ou un compte directement dans l'application (Paramètres → Signaler) ou par email à contact@solodesign.fr.
            </Text>
            <Text style={[styles.termText, { fontWeight: 'bold', marginTop: 10 }]}>
              ENGAGEMENT DE RÉPONSE RAPIDE : Nous nous engageons à traiter tous les signalements de contenu inapproprié dans un délai maximum de 24 heures. Les contenus en violation seront immédiatement supprimés et l'utilisateur responsable sera exclu de la plateforme. Pour les contenus illégaux ou non consensuels, nous collaborons avec les autorités compétentes.
            </Text>
          </View>

          {/* 11. Protection des Données et Conservation */}
          <View style={styles.termBlock}>
            <Text style={styles.termTitle}>11. Protection des Données et Conservation</Text>
            <Text style={styles.termText}>
              Nous collectons et traitons vos données personnelles (pseudo, âge, sexe, ID d'appareil) conformément au RGPD. 
              Les contenus multimédias peuvent être conservés sur nos serveurs pour permettre le fonctionnement du service. 
              Les données ne sont jamais vendues à des tiers. Vous pouvez demander la suppression de vos données 
              en supprimant votre compte, ce qui entraînera la suppression définitive de toutes vos conversations.
            </Text>
          </View>

          {/* 11. Modifications des Conditions */}
          <View style={styles.termBlock}>
            <Text style={styles.termTitle}>12. Modifications des Conditions</Text>
            <Text style={styles.termText}>
              Nous nous réservons le droit de modifier ces conditions à tout moment. Les utilisateurs seront notifiés 
              des changements significatifs par notification dans l'application. L'utilisation continue de l'application 
              après modification constitue une acceptation des nouvelles conditions.
            </Text>
          </View>

          {/* 12. Résiliation */}
          <View style={styles.termBlock}>
            <Text style={styles.termTitle}>13. Résiliation et Suppression de Compte</Text>
            <Text style={styles.termText}>
              Vous pouvez supprimer votre compte à tout moment, ce qui entraînera la suppression immédiate et définitive 
              de toutes vos conversations et données. Nous pouvons également résilier votre accès en cas de violation 
              de ces conditions. Après résiliation, votre pseudo redeviendra disponible pour d'autres utilisateurs.
            </Text>
          </View>

          {/* 13. Responsabilité de l'Utilisateur */}
          <View style={styles.termBlock}>
            <Text style={styles.termTitle}>14. Responsabilité de l'Utilisateur</Text>
            <Text style={styles.termText}>
              Vous êtes seul responsable de votre utilisation de l'application et des conséquences qui en découlent. 
              Cela inclut mais ne se limite pas à : la vérification de votre âge, le respect des lois locales, 
              la protection de votre anonymat, et la gestion des risques liés au partage de contenu personnel. 
              Nous recommandons fortement la prudence et la réflexion avant tout partage de contenu personnel.
            </Text>
          </View>

          {/* 14. Juridiction et Droit Applicable */}
          <View style={styles.termBlock}>
            <Text style={styles.termTitle}>15. Juridiction et Droit Applicable</Text>
            <Text style={styles.termText}>
              Ces conditions sont régies par le droit français. Tout litige sera soumis à la juridiction exclusive 
              des tribunaux français. Si une disposition de ces conditions est déclarée invalide, 
              les autres dispositions restent en vigueur.
            </Text>
          </View>

          {/* 15. Contact */}
          <View style={styles.termBlock}>
            <Text style={styles.termTitle}>16. Contact</Text>
            <Text style={styles.termText}>
              Pour toute question ou signalement : contact@solodesign.fr
            </Text>
          </View>

        </View>

        {/* Footer Warning */}
        <View style={styles.warningSection}>
          <View style={styles.warningIcon}>
            <Ionicons name="warning" size={20} color={Colors.warning} />
          </View>
          <Text style={styles.warningText}>
            NoText est réservée aux 18+. Le contenu est généré par les utilisateurs et peut être sensible. 
            Utilisez avec discernement et responsabilité.
          </Text>
        </View>

        {/* Last Updated */}
        <View style={styles.footerSection}>
          <Text style={styles.footerText}>
            En utilisant NoText, vous acceptez ces conditions dans leur intégralité et reconnaissez avoir lu et compris 
            les risques associés au partage de contenu visuel.
          </Text>
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
  appName: {
    fontSize: Typography.lg,
    fontWeight: Typography.medium,
    color: Colors.white,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  lastUpdated: {
    fontSize: Typography.sm,
    color: Colors.gray400,
    textAlign: 'center',
  },
  
  // Terms Section
  termsSection: {
    marginBottom: Spacing.xl,
  },
  termBlock: {
    backgroundColor: Colors.gray900,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.gray800,
  },
  termTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.white,
    marginBottom: Spacing.sm,
  },
  termText: {
    fontSize: Typography.sm,
    color: Colors.gray300,
    lineHeight: 20,
  },
  
  // Warning Section
  warningSection: {
    backgroundColor: Colors.warning + '20',
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: Colors.warning + '40',
  },
  warningIcon: {
    marginRight: Spacing.md,
    marginTop: 2,
  },
  warningText: {
    fontSize: Typography.sm,
    color: Colors.warning,
    lineHeight: 18,
    flex: 1,
    fontWeight: Typography.medium,
  },
  
  // Footer Section
  footerSection: {
    backgroundColor: Colors.gray900,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.gray800,
  },
  footerText: {
    fontSize: Typography.sm,
    color: Colors.gray400,
    textAlign: 'center',
    fontStyle: 'italic',
  },
})

export default CGUScreen
