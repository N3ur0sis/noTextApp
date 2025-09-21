import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import React, { useRef, useState } from 'react'
import {
    Alert,
    Dimensions,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View
} from 'react-native'
import AppStatusBar from '../components/AppStatusBar'
import { BorderRadius, Colors, Spacing, Typography } from '../constants/Design'
import { useAuthContext } from '../context/AuthContext'
import { RobustDeviceAuthService } from '../services/robustDeviceAuthService'
import {
    getKeyboardAvoidingProps,
    getResponsiveButtonHeight,
    getResponsiveDimensions,
    getResponsiveInputHeight,
    getResponsiveSpacing,
    getScrollContentPadding
} from '../utils/responsive'

const { height } = Dimensions.get('window')
const responsiveDimensions = getResponsiveDimensions()
const scrollPadding = getScrollContentPadding()
const keyboardProps = getKeyboardAvoidingProps()
const responsiveSpacing = getResponsiveSpacing()

const AuthScreen = ({ onAuthSuccess = null }) => {
  const { login } = useAuthContext()
  const [pseudo, setPseudo] = useState('')
  const [age, setAge] = useState('')
  const [sexe, setSexe] = useState('')
  const [loading, setLoading] = useState(false)
  const [acceptTerms, setAcceptTerms] = useState(false)
  
  // Refs for input navigation
  const pseudoInputRef = useRef(null)
  const ageInputRef = useRef(null)

  const dismissKeyboard = () => {
    Keyboard.dismiss()
  }

  const handleAuth = async () => {
    if (!pseudo.trim() || !age) {
      Alert.alert('Erreur', 'Veuillez remplir le pseudo et l\'âge')
      return
    }

    if (parseInt(age) < 18) {
      Alert.alert('Erreur', 'Vous devez avoir au moins 18 ans')
      return
    }

    if (pseudo.length < 3) {
      Alert.alert('Erreur', 'Le pseudo doit contenir au moins 3 caractères')
      return
    }

    if (!acceptTerms) {
      Alert.alert('Erreur', 'Vous devez accepter les conditions d\'utilisation pour continuer')
      return
    }

    setLoading(true)
    try {
      console.log('📝 [AUTH_SCREEN] Starting robust registration for pseudo:', pseudo.trim())
      
      const result = await RobustDeviceAuthService.register(pseudo.trim(), parseInt(age), sexe || 'Autre')
      
      console.log('✅ [AUTH_SCREEN] Registration result:', { 
        userPseudo: result.user?.pseudo, 
        isNewAccount: result.isNewAccount, 
        isRecovery: result.isRecovery 
      })
      
      // Update auth context with appropriate flags
      const isNewAccount = result.isNewAccount || false
      await login(result.user, isNewAccount)
      
      // Show different messages based on result type
      if (result.isRecovery) {
        Alert.alert(
          'Compte récupéré', 
          `Bienvenue à nouveau ${result.user.pseudo} ! Votre compte a été récupéré avec succès.`,
          [{ text: 'OK' }]
        )
      }
      
      if (onAuthSuccess) {
        onAuthSuccess(result.user)
      } else {
        // Navigate to home - AuthContext will pick up the new user
        router.push('/home')
      }
    } catch (error) {
      console.error('❌ [AUTH_SCREEN] Registration error:', error)
      
      // Show more user-friendly error messages
      let errorMessage = error.message || 'Impossible de créer le compte'
      
      if (error.message?.includes('connexion internet')) {
        errorMessage = 'Pas de connexion internet. Veuillez vérifier votre connexion et réessayer.'
      } else if (error.message?.includes('pseudo')) {
        errorMessage = 'Ce pseudo est déjà utilisé. Choisissez un autre pseudo.'
      } else if (error.message?.includes('timeout')) {
        errorMessage = 'La connexion a expiré. Veuillez vérifier votre connexion et réessayer.'
      }
      
      Alert.alert('Erreur', errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const SexeButton = ({ value, label, selected, onPress }) => (
    <TouchableOpacity
      style={[styles.sexeButton, selected && styles.sexeButtonSelected]}
      onPress={() => onPress(value)}
      activeOpacity={0.8}
    >
      <Text style={[styles.sexeButtonText, selected && styles.sexeButtonTextSelected]}>
        {label}
      </Text>
    </TouchableOpacity>
  )

  return (
    <View style={styles.container}>
      {/* Background catcher */}
      <Pressable
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
      <AppStatusBar barStyle="light-content" />
      <KeyboardAvoidingView 
        behavior={keyboardProps.behavior}
        style={styles.keyboardView}
        keyboardVerticalOffset={keyboardProps.keyboardVerticalOffset}
        enabled={keyboardProps.enabled}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Clean header with logo */}
          <View style={styles.header}>
            <View style={styles.logoContainer}>
              <Ionicons name="flash" size={48} color={Colors.white} />
            </View>
            <Text style={styles.title}>NoText</Text>
            <Text style={styles.subtitle}>Communication sans limites</Text>
          </View>

          {/* Clean form */}
          <View style={styles.formContainer}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Pseudo</Text>
              <TextInput
                ref={pseudoInputRef}
                style={styles.input}
                placeholder="Votre pseudo unique"
                placeholderTextColor={Colors.gray500}
                value={pseudo}
                onChangeText={setPseudo}
                autoCapitalize="none"
                maxLength={20}
                returnKeyType="next"
                blurOnSubmit={false}
                autoCorrect={false}
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
                onTouchStart={() => console.log('[INPUT]   touch-start')}
                onFocus={() => console.log('[INPUT]   focused')}
                onSubmitEditing={() => {
                  // Focus on age input when done with pseudo
                  if (ageInputRef.current) {
                    ageInputRef.current.focus()
                  }
                }}
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Âge</Text>
              <TextInput
                ref={ageInputRef}
                style={styles.input}
                placeholder="18+"
                placeholderTextColor={Colors.gray500}
                value={age}
                onChangeText={setAge}
                keyboardType="numeric"
                maxLength={2}
                returnKeyType="done"
                autoCorrect={false}
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
                onSubmitEditing={dismissKeyboard}
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Genre (optionnel)</Text>
              <View style={styles.sexeContainer}>
                <SexeButton
                  value="H"
                  label="Homme"
                  selected={sexe === 'H'}
                  onPress={setSexe}
                />
                <SexeButton
                  value="F"
                  label="Femme"
                  selected={sexe === 'F'}
                  onPress={setSexe}
                />
                <SexeButton
                  value="Autre"
                  label="Autre"
                  selected={sexe === 'Autre'}
                  onPress={setSexe}
                />
                <SexeButton
                  value=""
                  label="Ne pas préciser"
                  selected={sexe === ''}
                  onPress={setSexe}
                />
              </View>
            </View>

            {/* Terms of Service Agreement */}
            <View style={styles.inputGroup}>
              <TouchableOpacity 
                style={styles.termsContainer}
                onPress={() => setAcceptTerms(!acceptTerms)}
                activeOpacity={0.8}
              >
                <View style={[styles.checkbox, acceptTerms && styles.checkboxSelected]}>
                  {acceptTerms && (
                    <Ionicons name="checkmark" size={14} color={Colors.black} />
                  )}
                </View>
                <View style={styles.termsTextContainer}>
                  <Text style={styles.termsText}>
                    J'accepte les{' '}
                    <TouchableOpacity 
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                        router.push('/cgu')
                      }}
                      style={styles.termsLink}
                    >
                      <Text style={styles.termsLinkText}>Conditions Générales d'Utilisation</Text>
                    </TouchableOpacity>
                    {' '}et confirme avoir 18 ans ou plus. Je comprends que cette application contient du contenu généré par les utilisateurs et qu'il n'y a aucune tolérance pour les contenus inappropriés ou les comportements abusifs.
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
          {/* Clean action button */}
          <TouchableOpacity
            style={[styles.continueButton, loading && styles.continueButtonDisabled]}
            onPress={handleAuth}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <View style={styles.loadingContainer}>
                <Text style={styles.continueButtonText}>Connexion...</Text>
              </View>
            ) : (
              <View style={styles.buttonContent}>
                <Text style={styles.continueButtonText}>Commencer</Text>
                <Ionicons name="arrow-forward" size={20} color={Colors.black} />
              </View>
            )}
          </TouchableOpacity>
          {/* UGC Warning */}
          <View style={styles.warningContainer}>
            <Ionicons name="warning-outline" size={16} color={Colors.warning} />
            <Text style={styles.warning}>
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.black,
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: responsiveSpacing.screenPadding,
    paddingTop: scrollPadding.paddingTop,
    paddingBottom: scrollPadding.paddingBottom,
  },
  
  // Clean header
  header: {
    alignItems: 'center',
    marginBottom: responsiveSpacing.sectionSpacing * 1.5,
  },
  logoContainer: {
    width: Platform.OS === 'android' ? 72 : 80, // Slightly smaller on Android
    height: Platform.OS === 'android' ? 72 : 80,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.whiteOverlay,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  title: {
    fontSize: Platform.OS === 'android' ? Typography.xxl : Typography.xxxl, // Smaller on Android
    fontWeight: Typography.bold,
    color: Colors.white,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: Typography.base,
    fontWeight: Typography.light,
    color: Colors.gray400,
  },
  
  // Clean form
  formContainer: {
    flex: 1,
    justifyContent: 'center',
    minHeight: responsiveDimensions.formHeight,
  },
  inputGroup: {
    marginBottom: responsiveSpacing.inputSpacing,
  },
  inputLabel: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.white,
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  input: {
    backgroundColor: Colors.gray800,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Platform.OS === 'android' ? Spacing.md + 2 : Spacing.md, // Slightly more padding on Android
    color: Colors.white,
    fontSize: Typography.base,
    fontWeight: Typography.regular,
    borderWidth: 1,
    borderColor: Colors.gray700,
    minHeight: getResponsiveInputHeight(),
  },
  
  // Gender selection
  sexeContainer: {
    flexDirection: 'row',
    gap: Platform.OS === 'android' ? Spacing.sm : Spacing.sm, // Consistent gap
  },
  sexeButton: {
    flex: 1,
    backgroundColor: Colors.gray800,
    borderRadius: BorderRadius.base,
    paddingVertical: Platform.OS === 'android' ? Spacing.md + 2 : Spacing.md, // More padding on Android
    paddingHorizontal: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.gray700,
    alignItems: 'center',
    minHeight: Platform.OS === 'android' ? 48 : 44, // Taller on Android
    justifyContent: 'center',
  },
  sexeButtonSelected: {
    backgroundColor: Colors.white,
    borderColor: Colors.white,
  },
  sexeButtonText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.gray400,
  },
  sexeButtonTextSelected: {
    color: Colors.black,
    fontWeight: Typography.semiBold,
  },
  
  // Terms of Service
  termsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: Spacing.md,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: Colors.gray600,
    backgroundColor: Colors.transparent,
    marginRight: Spacing.sm,
    marginTop: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: Colors.white,
    borderColor: Colors.white,
  },
  termsTextContainer: {
    flex: 1,
  },
  termsText: {
    fontSize: Typography.sm,
    color: Colors.gray400,
    lineHeight: 18,
  },
  termsLink: {
    alignSelf: 'flex-start',
  },
  termsLinkText: {
    color: Colors.white,
    textDecorationLine: 'underline',
    fontWeight: Typography.medium,
  },
  
  // Action button
  continueButton: {
    backgroundColor: Colors.white,
    borderRadius: BorderRadius.full,
    paddingVertical: Platform.OS === 'android' ? Spacing.lg + 2 : Spacing.lg, // More padding on Android
    paddingHorizontal: Spacing.xl,
    marginTop: responsiveSpacing.buttonSpacing,
    marginBottom: responsiveSpacing.buttonSpacing,
    minHeight: getResponsiveButtonHeight(),
  },
  continueButtonDisabled: {
    opacity: 0.6,
  },
  buttonContent: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  loadingContainer: {
    alignItems: 'center',
  },
  continueButtonText: {
    fontSize: Typography.lg,
    fontWeight: Typography.semiBold,
    color: Colors.black,
  },
  
  // Warning
  warningContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  warning: {
    flex: 1,
    fontSize: Typography.sm,
    fontWeight: Typography.regular,
    color: Colors.gray500,
    lineHeight: 20,
  },
})

export default AuthScreen
