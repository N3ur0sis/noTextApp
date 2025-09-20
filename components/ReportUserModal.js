import React, { useState } from 'react'
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform
} from 'react-native'
import { Colors, Typography } from '../constants/Design'
import { apiManager } from '../services/apiManager'

const REPORT_CATEGORIES = [
  { id: 'harassment', label: 'Harcèlement', description: 'Messages répétés non désirés' },
  { id: 'inappropriate_content', label: 'Contenu inapproprié', description: 'Contenu offensant ou non conforme' },
  { id: 'spam', label: 'Spam', description: 'Messages publicitaires ou répétitifs' },
  { id: 'fake_profile', label: 'Faux profil', description: 'Profil avec de fausses informations' },
  { id: 'minor', label: 'Mineur', description: 'Utilisateur apparemment mineur' },
  { id: 'threats', label: 'Menaces', description: 'Menaces ou intimidation' },
  { id: 'other', label: 'Autre', description: 'Autre motif de signalement' }
]

export default function ReportUserModal({ 
  visible, 
  onClose, 
  reportedUser = null, 
  onSubmit,
  currentUser = null,
  allowUserSearch = false // New prop to enable search when no user is pre-selected
}) {
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [description, setDescription] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // User search functionality
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [selectedUser, setSelectedUser] = useState(reportedUser)
  const [isSearching, setIsSearching] = useState(false)
  const searchTimeoutRef = React.useRef(null)

  // Update selectedUser when reportedUser prop changes
  React.useEffect(() => {
    setSelectedUser(reportedUser)
    if (reportedUser) {
      setSearchQuery(reportedUser.pseudo || '')
    }
  }, [reportedUser])

  // Reset form when modal closes
  React.useEffect(() => {
    if (!visible) {
      setSelectedCategory(null)
      setDescription('')
      setSearchQuery('')
      setSearchResults([])
      if (!reportedUser) {
        setSelectedUser(null)
      }
      // Clear search timeout
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [visible, reportedUser])

  // Cleanup timeout on unmount
  React.useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [])

  // Real user search function using apiManager (same as HomeScreen)
  const searchUsers = async (query) => {
    if (!query.trim() || query.length < 2) {
      setSearchResults([])
      return
    }

    setIsSearching(true)
    try {
      console.log('🔍 [REPORT] Searching users with query:', query.trim())
      
      // Use the same apiManager as HomeScreen for consistent results
      const results = await apiManager.searchUsers(query.trim())
      
      // Filter out current user from results (can't report yourself)
      const filtered = results.filter(user => user.id !== currentUser?.id)
      
      console.log('✅ [REPORT] Search results:', {
        total: results.length,
        filtered: filtered.length,
        query: query.trim()
      })
      
      setSearchResults(filtered.slice(0, 10)) // Limit to 10 results for better UX
    } catch (error) {
      console.error('❌ [REPORT] User search error:', error)
      setSearchResults([])
      // Don't show error to user, just log it
    } finally {
      setIsSearching(false)
    }
  }

  // Handle search input change with debouncing (same as HomeScreen)
  const handleSearchChange = (text) => {
    const trimmedText = text.trim()
    setSearchQuery(text)
    
    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    if (trimmedText.length < 2) {
      setSearchResults([])
      return
    }

    // Debounce search by 300ms to avoid excessive API calls
    searchTimeoutRef.current = setTimeout(() => {
      searchUsers(trimmedText)
    }, 300)
  }

  // Handle user selection from search results
  const handleUserSelect = (user) => {
    console.log('👤 [REPORT_USER] Selected user:', {
      id: user.id,
      pseudo: user.pseudo,
      age: user.age,
      Age: user.Age,
      sexe: user.sexe,
      gender: user.gender,
      allKeys: Object.keys(user)
    })
    setSelectedUser(user)
    setSearchQuery(user.pseudo)
    setSearchResults([])
  }

  const handleSubmit = async () => {
    if (!selectedCategory) {
      Alert.alert('Erreur', 'Veuillez sélectionner une catégorie de signalement')
      return
    }

    if (!description.trim()) {
      Alert.alert('Erreur', 'Veuillez décrire le problème')
      return
    }

    if (!selectedUser) {
      Alert.alert('Erreur', 'Veuillez sélectionner un utilisateur à signaler')
      return
    }

    if (!currentUser) {
      Alert.alert('Erreur', 'Impossible d\'identifier l\'utilisateur qui fait le signalement')
      return
    }

    setIsSubmitting(true)

    try {
      const reportData = {
        type: 'user', // Ajouter le type explicitement
        reportedUser: {
          id: selectedUser.id,
          pseudo: selectedUser.pseudo
        },
        reporter: {
          id: currentUser.id,
          pseudo: currentUser.pseudo
        },
        category: selectedCategory,
        description: description.trim(),
        timestamp: new Date().toISOString()
      }

      await onSubmit(reportData)
      
      // Reset form
      setSelectedCategory(null)
      setDescription('')
      onClose()
      
      Alert.alert(
        'Signalement envoyé',
        'Votre signalement a été transmis à notre équipe de modération. Merci de contribuer à la sécurité de la communauté.',
        [{ text: 'OK' }]
      )
    } catch (error) {
      console.error('❌ [REPORT] Error submitting report:', error)
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
            <Text style={styles.title}>
              {selectedUser ? `Signaler ${selectedUser.pseudo}` : 'Signaler un utilisateur'}
            </Text>
            <TouchableOpacity 
              onPress={handleSubmit} 
              style={[styles.submitButton, (!selectedCategory || !description.trim() || !selectedUser) && styles.submitButtonDisabled]}
              disabled={!selectedCategory || !description.trim() || !selectedUser || isSubmitting}
            >
              <Text style={[styles.submitButtonText, (!selectedCategory || !description.trim() || !selectedUser) && styles.submitButtonTextDisabled]}>
                {isSubmitting ? 'Envoi...' : 'Envoyer'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {/* User Selection - Show search if no user pre-selected OR if allowUserSearch is true */}
            {(!reportedUser || allowUserSearch) && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Sélectionner l'utilisateur à signaler</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Rechercher un utilisateur..."
                  value={searchQuery}
                  onChangeText={handleSearchChange}
                  autoCapitalize="none"
                />
                {isSearching && (
                  <Text style={styles.searchingText}>Recherche en cours...</Text>
                )}
                {searchResults.length > 0 && (
                  <View style={styles.searchResults}>
                    {searchResults.map((user) => (
                      <TouchableOpacity
                        key={user.id}
                        style={styles.searchResultItem}
                        onPress={() => handleUserSelect(user)}
                      >
                        <View style={styles.searchResultMain}>
                          <Text style={styles.searchResultPseudo}>{user.pseudo}</Text>
                          <Text style={styles.searchResultInfo}>
                            {user.age ? `${user.age} ans` : (user.Age ? `${user.Age} ans` : '')}{(user.age || user.Age) && (user.sexe || user.gender) ? ' • ' : ''}{user.sexe || user.gender || ''}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Selected User Display */}
            {selectedUser && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Utilisateur signalé</Text>
                <View style={styles.reportedUserInfo}>
                  <Text style={styles.reportedUserPseudo}>{selectedUser.pseudo}</Text>
                  {(selectedUser.age || selectedUser.Age || selectedUser.sexe || selectedUser.gender) && (
                    <Text style={styles.reportedUserSubtext}>
                      {selectedUser.age ? `${selectedUser.age} ans` : (selectedUser.Age ? `${selectedUser.Age} ans` : '')}{(selectedUser.age || selectedUser.Age) && (selectedUser.sexe || selectedUser.gender) ? ' • ' : ''}{selectedUser.sexe || selectedUser.gender || ''}
                    </Text>
                  )}
                  {allowUserSearch && (
                    <TouchableOpacity 
                      style={styles.changeUserButton}
                      onPress={() => {
                        setSelectedUser(null)
                        setSearchQuery('')
                      }}
                    >
                      <Text style={styles.changeUserText}>Changer d'utilisateur</Text>
                    </TouchableOpacity>
                  )}
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
                numberOfLines={6}
                maxLength={1000}
                textAlignVertical="top"
              />
              <Text style={styles.characterCount}>{description.length}/1000</Text>
            </View>

            {/* Selected Category Info */}
            {selectedCategoryData && (
              <View style={styles.selectedCategoryInfo}>
                <Text style={styles.selectedCategoryTitle}>Catégorie sélectionnée :</Text>
                <Text style={styles.selectedCategoryLabel}>{selectedCategoryData.label}</Text>
              </View>
            )}

            {/* Disclaimer */}
            <View style={styles.disclaimer}>
              <Text style={styles.disclaimerText}>
                ⚠️ Les signalements abusifs ou répétés peuvent entraîner des sanctions. 
                Votre signalement sera traité par notre équipe de modération dans les plus brefs délais.
              </Text>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = {
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray300,
    backgroundColor: Colors.white,
  },
  closeButton: {
    padding: 5,
  },
  closeButtonText: {
    color: Colors.accent,
    fontSize: 16,
    fontWeight: '500',
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
    backgroundColor: Colors.accent,
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
  input: {
    borderWidth: 1,
    borderColor: Colors.gray300,
    borderRadius: 10,
    paddingHorizontal: 15,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: Colors.white,
  },
  reportedUserInfo: {
    backgroundColor: Colors.gray100,
    borderRadius: 10,
    padding: 15,
    borderWidth: 1,
    borderColor: Colors.gray300,
  },
  reportedUserPseudo: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.black,
    marginBottom: 4,
  },
  reportedUserSubtext: {
    fontSize: 14,
    color: Colors.gray500,
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
    borderColor: Colors.accent,
    backgroundColor: Colors.gray100,
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
    color: Colors.accent,
  },
  categoryDescription: {
    fontSize: 14,
    color: Colors.gray500,
  },
  categoryDescriptionSelected: {
    color: Colors.accent,
  },
  radioButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  radioButtonSelected: {
    borderColor: Colors.primary,
  },
  radioButtonInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.primary,
  },
  textArea: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 15,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: Colors.white,
    minHeight: 120,
  },
  characterCount: {
    textAlign: 'right',
    color: Colors.grayMedium,
    fontSize: 12,
    marginTop: 5,
  },
  selectedCategoryInfo: {
    backgroundColor: Colors.primaryLight,
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
  },
  selectedCategoryTitle: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '500',
  },
  selectedCategoryLabel: {
    fontSize: 16,
    color: Colors.primary,
    fontWeight: '600',
    marginTop: 2,
  },
  disclaimer: {
    backgroundColor: Colors.warningLight,
    padding: 15,
    borderRadius: 10,
    marginBottom: 30,
  },
  disclaimerText: {
    fontSize: 14,
    color: Colors.fire,
    lineHeight: 20,
  },
  // Search functionality styles
  searchingText: {
    fontSize: 14,
    color: Colors.gray500,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 10,
  },
  searchResults: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: Colors.gray300,
    borderRadius: 10,
    backgroundColor: Colors.white,
    maxHeight: 200,
  },
  searchResultItem: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray200,
    backgroundColor: Colors.white,
  },
  searchResultMain: {
    flex: 1,
  },
  searchResultPseudo: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.black,
    marginBottom: 2,
  },
  searchResultInfo: {
    fontSize: 14,
    color: Colors.gray500,
    marginBottom: 2,
  },
  changeUserButton: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: Colors.gray200,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  changeUserText: {
    fontSize: 14,
    color: Colors.accent,
    fontWeight: '500',
  },
}
