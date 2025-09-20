import React, { useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Typography, BorderRadius } from '../constants/Design'

const REPORT_CATEGORIES = [
  {
    id: 'inappropriate_content',
    label: 'Contenu inapproprié',
    description: 'Contenu sexuellement explicite, violent ou choquant'
  },
  {
    id: 'harassment',
    label: 'Harcèlement',
    description: 'Menaces, intimidation ou comportement abusif'
  },
  {
    id: 'spam',
    label: 'Spam',
    description: 'Contenu répétitif ou non désiré'
  },
  {
    id: 'illegal_content',
    label: 'Contenu illégal',
    description: 'Contenu qui viole les lois'
  },
  {
    id: 'minor_safety',
    label: 'Sécurité des mineurs',
    description: 'Contenu impliquant des mineurs de façon inappropriée'
  },
  {
    id: 'non_consensual',
    label: 'Contenu non consensuel',
    description: 'Partage de contenu sans consentement'
  },
  {
    id: 'other',
    label: 'Autre',
    description: 'Autre problème non listé ci-dessus'
  }
]

export default function ReportContentModal({ 
  visible, 
  onClose, 
  message = null,
  currentUser = null,
  onSubmit
}) {
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [description, setDescription] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Reset form when modal closes
  React.useEffect(() => {
    if (!visible) {
      setSelectedCategory(null)
      setDescription('')
      setIsSubmitting(false)
    }
  }, [visible])

  const handleSubmit = async () => {
    if (!selectedCategory) {
      Alert.alert('Erreur', 'Veuillez sélectionner une catégorie de signalement')
      return
    }

    if (!description.trim()) {
      Alert.alert('Erreur', 'Veuillez décrire le problème')
      return
    }

    if (!message) {
      Alert.alert('Erreur', 'Aucun message sélectionné')
      return
    }

    if (!currentUser) {
      Alert.alert('Erreur', 'Impossible d\'identifier l\'utilisateur qui fait le signalement')
      return
    }

    setIsSubmitting(true)

    try {
      const reportData = {
        type: 'content',
        message: {
          id: message.id,
          sender_id: message.sender_id,
          content_type: message.media_type || 'image',
          created_at: message.created_at
        },
        reporter: {
          id: currentUser.id,
          pseudo: currentUser.pseudo
        },
        category: selectedCategory,
        description: description.trim(),
        timestamp: new Date().toISOString()
      }

      console.log('📧 [REPORT_CONTENT_MODAL] Submitting report:', {
        type: reportData.type,
        messageId: reportData.message.id,
        category: reportData.category,
        reporterId: reportData.reporter.id
      })

      await onSubmit(reportData)
      
      // Reset form
      setSelectedCategory(null)
      setDescription('')
      onClose()
      
      Alert.alert(
        'Contenu signalé',
        'Votre signalement a été transmis à notre équipe de modération. Le contenu sera examiné dans les 24 heures. Merci de contribuer à la sécurité de la communauté.',
        [{ text: 'OK' }]
      )
    } catch (error) {
      console.error('❌ [REPORT_CONTENT] Error submitting report:', error)
      Alert.alert(
        'Erreur',
        'Impossible d\'envoyer le signalement. Veuillez réessayer plus tard.',
        [{ text: 'OK' }]
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const selectedCategoryData = REPORT_CATEGORIES.find(cat => cat.id === selectedCategory)

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView 
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>Annuler</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Signaler ce contenu</Text>
            <TouchableOpacity 
              onPress={handleSubmit} 
              style={[styles.submitButton, (!selectedCategory || !description.trim()) && styles.submitButtonDisabled]}
              disabled={!selectedCategory || !description.trim() || isSubmitting}
            >
              <Text style={[styles.submitButtonText, (!selectedCategory || !description.trim()) && styles.submitButtonTextDisabled]}>
                {isSubmitting ? 'Envoi...' : 'Signaler'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView 
            style={styles.content} 
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Warning */}
            <View style={styles.warningSection}>
              <Ionicons name="warning" size={24} color={Colors.warning} />
              <Text style={styles.warningText}>
                Signalez uniquement les contenus qui violent nos conditions d'utilisation. 
                Les signalements abusifs peuvent entraîner des sanctions.
              </Text>
            </View>

            {/* Content Info */}
            {message && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Contenu signalé</Text>
                <View style={styles.contentInfo}>
                  <Ionicons 
                    name={message.media_type === 'video' ? 'videocam' : 'image'} 
                    size={20} 
                    color={Colors.gray400} 
                  />
                  <View style={styles.contentDetails}>
                    <Text style={styles.contentText}>
                      {message.media_type === 'video' ? 'Vidéo' : 'Image'}
                    </Text>
                    <Text style={styles.contentTime}>
                      {new Date(message.created_at).toLocaleDateString('fr-FR', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                      })} à {new Date(message.created_at).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* Category Selection */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Motif du signalement</Text>
              <Text style={styles.sectionSubtitle}>Sélectionnez la catégorie qui correspond le mieux au problème</Text>
              
              {REPORT_CATEGORIES.map((category) => (
                <TouchableOpacity
                  key={category.id}
                  style={[
                    styles.categoryItem,
                    selectedCategory === category.id && styles.categoryItemSelected
                  ]}
                  onPress={() => setSelectedCategory(category.id)}
                >
                  <View style={styles.categoryContent}>
                    <Text style={[
                      styles.categoryLabel,
                      selectedCategory === category.id && styles.categoryLabelSelected
                    ]}>
                      {category.label}
                    </Text>
                    <Text style={[
                      styles.categoryDescription,
                      selectedCategory === category.id && styles.categoryDescriptionSelected
                    ]}>
                      {category.description}
                    </Text>
                  </View>
                  <View style={[
                    styles.radioButton,
                    selectedCategory === category.id && styles.radioButtonSelected
                  ]}>
                    {selectedCategory === category.id && <View style={styles.radioButtonInner} />}
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            {/* Description */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Description détaillée</Text>
              <Text style={styles.sectionSubtitle}>
                Décrivez le problème en détail. Plus vous fournirez d'informations, plus nous pourrons traiter efficacement votre signalement.
              </Text>
              <TextInput
                style={styles.textArea}
                placeholder="Décrivez le problème rencontré..."
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={4}
                maxLength={1000}
                textAlignVertical="top"
              />
              <Text style={styles.characterCount}>{description.length}/1000</Text>
            </View>

            {/* Selected Category Info */}
            {selectedCategoryData && (
              <View style={styles.selectedCategoryInfo}>
                <Text style={styles.selectedCategoryTitle}>Catégorie sélectionnée</Text>
                <Text style={styles.selectedCategoryLabel}>{selectedCategoryData.label}</Text>
              </View>
            )}
            {/* Disclaimer */}
            <View style={styles.disclaimer}>
              <Ionicons name="information-circle" size={16} color={Colors.gray500} style={styles.disclaimerIcon} />
              <Text style={styles.disclaimerText}>
                Les signalements abusifs ou répétés peuvent entraîner des sanctions sur votre compte.
              </Text>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 60 : 20,
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray200,
  },
  closeButton: {
    paddingVertical: 8,
  },
  closeButtonText: {
    fontSize: 16,
    color: Colors.gray500,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.black,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 20,
  },
  submitButton: {
    backgroundColor: Colors.fire,
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
  },
  submitButtonDisabled: {
    backgroundColor: Colors.gray300,
  },
  submitButtonText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  submitButtonTextDisabled: {
    color: Colors.gray500,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  section: {
    marginVertical: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.black,
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: Colors.gray500,
    marginBottom: 15,
    lineHeight: 20,
  },
  warningSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.warning + '15',
    padding: 15,
    borderRadius: 10,
    marginTop: 20,
  },
  warningText: {
    flex: 1,
    fontSize: 14,
    color: Colors.warning,
    marginLeft: 10,
    lineHeight: 20,
  },
  contentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.gray100,
    padding: 15,
    borderRadius: 10,
  },
  contentText: {
    fontSize: 16,
    color: Colors.black,
    fontWeight: '500',
  },
  contentDetails: {
    marginLeft: 10,
  },
  contentTime: {
    fontSize: 14,
    color: Colors.gray500,
    marginTop: 2,
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.gray300,
    borderRadius: 10,
    padding: 15,
    marginBottom: 10,
  },
  categoryItemSelected: {
    borderColor: Colors.fire,
    backgroundColor: Colors.fire + '10',
  },
  categoryContent: {
    flex: 1,
  },
  categoryLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.black,
    marginBottom: 4,
  },
  categoryLabelSelected: {
    color: Colors.fire,
  },
  categoryDescription: {
    fontSize: 14,
    color: Colors.gray500,
  },
  categoryDescriptionSelected: {
    color: Colors.fire,
  },
  radioButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.gray300,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  radioButtonSelected: {
    borderColor: Colors.fire,
  },
  radioButtonInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.fire,
  },
  textArea: {
    borderWidth: 1,
    borderColor: Colors.gray300,
    borderRadius: 10,
    paddingHorizontal: 15,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: Colors.white,
    minHeight: 120,
  },
  characterCount: {
    textAlign: 'right',
    color: Colors.gray500,
    fontSize: 12,
    marginTop: 5,
  },
  selectedCategoryInfo: {
    backgroundColor: Colors.fire + '15',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
  },
  selectedCategoryTitle: {
    fontSize: 14,
    color: Colors.fire,
    fontWeight: '500',
  },
  selectedCategoryLabel: {
    fontSize: 16,
    color: Colors.fire,
    fontWeight: '600',
    marginTop: 2,
  },
  submitInfo: {
    backgroundColor: Colors.primary + '15',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
  },
  submitInfoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.primary,
    marginBottom: 8,
  },
  submitInfoText: {
    fontSize: 14,
    color: Colors.primary,
    lineHeight: 20,
  },
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.gray100,
    padding: 15,
    borderRadius: 10,
    marginBottom: 30,
  },
  disclaimerIcon: {
    marginRight: 8,
    marginTop: 1,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 14,
    color: Colors.gray600,
    lineHeight: 20,
  },
})
