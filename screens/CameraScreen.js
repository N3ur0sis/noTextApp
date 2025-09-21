import { Ionicons } from '@expo/vector-icons'
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera'
import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import * as ImageManipulator from 'expo-image-manipulator'
import { LinearGradient } from 'expo-linear-gradient'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useVideoPlayer, VideoView } from 'expo-video'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Animated,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native'
import { PinchGestureHandler as RNGHPinchGestureHandler, State as RNGHState, TapGestureHandler } from 'react-native-gesture-handler'
import AppStatusBar from '../components/AppStatusBar'
import { BorderRadius, Colors, Layout, Spacing, Typography } from '../constants/Design'
import { useAuthContext } from '../context/AuthContext'
import { uploadMedia } from '../services/unifiedMediaService'
import { backgroundMessageService } from '../services/backgroundMessageService'
import { getImageInfo, optimizeImageForUpload } from '../utils/imageOptimizer'
import { compressVideoAuto, getVideoMetadata } from '../utils/videoUtils'
import { getKeyboardAvoidingProps, getSafeAreaTop } from '../utils/responsive'
import { getCameraType, saveCameraType } from '../utils/secureStore'

const { width, height } = Dimensions.get('window')
const keyboardProps = getKeyboardAvoidingProps()

const CameraScreen = () => {
  const { user: currentUser } = useAuthContext()
  const { otherUser: otherUserParam, otherUserId } = useLocalSearchParams()
  const otherUser = otherUserParam ? JSON.parse(otherUserParam) : null
  const [permission, requestPermission] = useCameraPermissions()
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions()
  const [type, setType] = useState('back')
  const [isRecording, setIsRecording] = useState(false)
  const [mediaMode, setMediaMode] = useState('permanent') // 'permanent', 'one_time', 'nsfw'
  const [caption, setCaption] = useState('')
  const [capturedMedia, setCapturedMedia] = useState(null)
  const [mediaType, setMediaType] = useState(null)
  const [capturedVideoMuted, setCapturedVideoMuted] = useState(false) // For preview mute control
  const [capturedFromFrontCamera, setCapturedFromFrontCamera] = useState(false) // Track if media was captured from front camera
  const [loading, setLoading] = useState(false)
  const [compressionProgress, setCompressionProgress] = useState(0) // Track video compression progress
  
  // Reset navigation flag when camera mounts to prevent video resource conflicts
  useEffect(() => {
    console.log('📷 [CAMERA] Camera screen mounted, clearing navigation flag')
    // Reset the navigation flag to allow videos to play normally again
    global._isNavigatingToCamera = false
    
    return () => {
      // Clear flag on unmount as well to ensure it's never left set
      global._isNavigatingToCamera = false
    }
  }, [])
  const [loadingStage, setLoadingStage] = useState('') // Track what we're currently doing
  const [recordingProgress] = useState(new Animated.Value(0))
  const [recordingTime, setRecordingTime] = useState(0)
  const [isRecordingActive, setIsRecordingActive] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0) // Track keyboard height
  const [isLongPressing, setIsLongPressing] = useState(false) // Track long press state
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false) // Track photo capture state
  // Platform-specific camera mode: Android starts in picture for fast photos, iOS stays in video
  const [cameraMode, setCameraMode] = useState(Platform.OS === 'android' ? 'picture' : 'video') // Android always starts in picture mode for instant photo capture
  const [isCameraReady, setIsCameraReady] = useState(false)
  const [recordingMode, setRecordingMode] = useState('photo') // 'photo' or 'video' - determines tap behavior
  const [isRecordingMuted, setIsRecordingMuted] = useState(true) // Whether to record audio or not
  const [cameraError, setCameraError] = useState(null) // Track camera mount errors
  const [isModeSwitching, setIsModeSwitching] = useState(false) // Track camera mode switching state
  
  // Timer functionality state
  const [timerSeconds, setTimerSeconds] = useState(0) // Timer delay: 0, 5, or 10 seconds
  const [isTimerActive, setIsTimerActive] = useState(false) // Whether timer is counting down
  const [timerCountdown, setTimerCountdown] = useState(0) // Current countdown value
  
  // Zoom functionality state
  const [zoom, setZoom] = useState(0) // Camera zoom level (0-1)
  const [baseZoom, setBaseZoom] = useState(0) // Base zoom for pinch gesture
  const [isZooming, setIsZooming] = useState(false) // Track if currently zooming
  
  const cameraRef = useRef(null)
  const recordingTimer = useRef(null)
  const longPressTimer = useRef(null) // Timer for long press detection
  const recordingTimeInterval = useRef(null)
  const recordStart = useRef(0) // timestamp when recordAsync begins
  const recordingPromiseRef = useRef(null) // Store recording promise
  const pinchGestureRef = useRef(null) // Reference for pinch gesture handler
  const doubleTapRef = useRef(null) // Reference for double tap gesture handler
  const timerInterval = useRef(null) // Timer countdown interval

  // Constants
  const MIN_VIDEO_MS = 2000 // 2s minimum for Android compatibility
  const MAX_ZOOM = 1.0 // Maximum zoom level
  const MIN_ZOOM = 0.0 // Minimum zoom level

  // Zoom helper functions
  const clampZoom = useCallback((zoomLevel) => {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomLevel))
  }, [])

  const updateCameraZoom = useCallback((newZoom) => {
    const clampedZoom = clampZoom(newZoom)
    setZoom(clampedZoom)
    
    // Update camera zoom if available
    if (cameraRef.current && isCameraReady) {
      try {
        // Note: expo-camera zoom prop will be used in the CameraView component
      } catch (error) {
        console.warn('Failed to update camera zoom:', error)
      }
    }
  }, [clampZoom, isCameraReady])

  // Pinch gesture handler for zoom
  const handlePinchGesture = useCallback((event) => {
    const { state, scale } = event.nativeEvent
    
    switch (state) {
      case RNGHState.BEGAN:
        setIsZooming(true)
        setBaseZoom(zoom)
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        break
        
      case RNGHState.ACTIVE:
        if (isZooming) {
          // Calculate new zoom based on pinch scale
          const newZoom = baseZoom + (scale - 1) * 0.5 // Adjust sensitivity
          updateCameraZoom(newZoom)
        }
        break
        
      case RNGHState.END:
      case RNGHState.CANCELLED:
      case RNGHState.FAILED:
        setIsZooming(false)
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        break
    }
  }, [zoom, baseZoom, isZooming, updateCameraZoom])

  // Reset zoom function
  const resetZoom = useCallback(() => {
    updateCameraZoom(0)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  }, [updateCameraZoom])

  // Double tap gesture handler for zoom reset
  const handleDoubleTap = useCallback((event) => {
    if (event.nativeEvent.state === RNGHState.ACTIVE) {
      if (zoom > 0.1) {
        resetZoom()
      } else {
        // If already at minimum zoom, zoom to 50%
        updateCameraZoom(0.5)
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      }
    }
  }, [zoom, resetZoom, updateCameraZoom])

  // Create video player for captured videos with better caching
  const videoPlayer = useVideoPlayer(
    capturedMedia && mediaType === 'video' ? capturedMedia : null, 
    player => {
      if (player && capturedMedia && mediaType === 'video') {
        player.loop = true
        player.muted = true // Mute for better performance
        player.play()
      }
    }
  )

  // Optimized video player effect - only update when necessary
  React.useEffect(() => {
    if (!videoPlayer) return
    
    if (capturedMedia && mediaType === 'video') {

      try {
        videoPlayer.replaceAsync(capturedMedia).then(() => {
          videoPlayer.play()

        }).catch(error => {
          console.warn('⚠️ Video player error:', error)
        })
      } catch (error) {
        console.warn('⚠️ Video player sync error:', error)
      }
    } else if (mediaType !== 'video') {
      // Clear video player when not showing video
      try {
        videoPlayer.replaceAsync(null).catch(console.warn)
      } catch (error) {
        console.warn('⚠️ Video player clear error:', error)
      }
    }
  }, [capturedMedia, mediaType, videoPlayer])

  React.useEffect(() => {
    (async () => {
      try {
        console.log('🔐 Requesting permissions...')
        
        // Request both camera and microphone permissions for video recording
        const permissionPromises = []
        
        if (!permission?.granted) {
          console.log('📷 Requesting camera permission...')
          permissionPromises.push(requestPermission())
        }
        
        if (!microphonePermission?.granted) {
          console.log('🎤 Requesting microphone permission...')
          permissionPromises.push(requestMicrophonePermission())
        }
        
        if (permissionPromises.length > 0) {
          const results = await Promise.all(permissionPromises)
          console.log('📷 Camera permission result:', permission?.granted ? 'already granted' : results[0]?.status || 'unknown')
          console.log('🎤 Microphone permission result:', microphonePermission?.granted ? 'already granted' : results[results.length - 1]?.status || 'unknown')
          
          // Check final permission status
          const finalCameraPermission = permission?.granted || results.find(r => r.canAskAgain !== undefined)?.granted
          const finalMicrophonePermission = microphonePermission?.granted || results.find(r => r.canAskAgain !== undefined)?.granted
          
          if (!finalCameraPermission || !finalMicrophonePermission) {
            const missingPermissions = []
            if (!finalCameraPermission) missingPermissions.push('caméra')
            if (!finalMicrophonePermission) missingPermissions.push('microphone')
            
            Alert.alert(
              'Permissions requises',
              `NoText a besoin d'accéder à votre ${missingPermissions.join(' et ')} pour prendre des photos et vidéos.`,
              [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Paramètres', onPress: () => {
                  // On Android, we can't directly open app settings, but we can inform the user
                  if (Platform.OS === 'android') {
                    Alert.alert(
                      'Permissions',
                      'Veuillez activer les permissions caméra et microphone dans les paramètres de l\'application.'
                    )
                  }
                }}
              ]
            )
          }
        }
        
        console.log('✅ Permission setup complete')
        
      } catch (error) {
        console.error('❌ Permission error:', error)
      }
    })()
    
    // Cleanup on unmount
    return () => {
      cleanupTimers()
    }
  }, [])

  // Use useFocusEffect for proper camera lifecycle management during navigation
  useFocusEffect(
    React.useCallback(() => {
      initializeCamera()

      return () => {
        cleanupCamera()
      }
    }, [])
  )

  // Remove the focus listener as it might cause conflicts
  // Instead, rely on proper mount/unmount lifecycle

  // Enhanced camera initialization with better error handling
  const initializeCamera = async () => {
    try {
      console.log('📷 [CAMERA] Starting camera initialization...')
      
      // Clear any previous camera errors
      setCameraError(null)
      
      // Simple state reset without cleanup that could interfere
      setIsCameraReady(false)
      setIsRecording(false)
      setIsRecordingActive(false)
      setCapturedMedia(null)
      setMediaType(null)
      setCaption('')
      setCapturedFromFrontCamera(false) // Reset front camera flag
      setIsModeSwitching(false)
      
      // Reset zoom state
      setZoom(0)
      setBaseZoom(0)
      setIsZooming(false)
      
      // Load saved camera type preference
      try {
        const savedCameraType = await getCameraType()
        setType(savedCameraType)
      } catch (error) {
        console.error('Failed to load camera type preference:', error)
        // Keep default 'back' camera if loading fails
      }
      
      // Reset progress animation
      recordingProgress.stopAnimation()
      recordingProgress.setValue(0)
      
      // Set platform-specific camera mode (Android: picture for fast photos, iOS: video)
      setCameraMode(Platform.OS === 'android' ? 'picture' : 'video') // Android always uses picture mode for instant capture
      
      // Camera will be ready when CameraView mounts and calls onCameraReady
      console.log('📷 [CAMERA] Camera initialization completed successfully')
      
    } catch (error) {
      console.error('❌ Camera initialization error:', error)
      setCameraError(error)
      setIsCameraReady(false)
    }
  }

  // Enhanced cleanup function with better safety checks
  const cleanupCamera = () => {
    console.log('📷 [CAMERA] Starting cleanup process...')
    
    // Stop any ongoing recording with proper null checks
    if (isRecordingActive && cameraRef.current) {
      try {
        console.log('📷 [CAMERA] Stopping active recording during cleanup')
        cameraRef.current.stopRecording().catch(error => {
          console.warn('⚠️ [CAMERA] Error stopping recording during cleanup:', error)
        })
      } catch (error) {
        console.warn('⚠️ [CAMERA] Sync error stopping recording during cleanup:', error)
      }
    }
    
    // Clean up timers
    cleanupTimers()
    
    // Reset recording state
    resetRecordingState()
    
    // Clear any pending recording promises to prevent memory leaks
    if (recordingPromiseRef.current) {
      recordingPromiseRef.current = null
      console.log('📷 [CAMERA] Cleared pending recording promise')
    }
    
    console.log('📷 [CAMERA] Cleanup completed')
  }

  // Centralized timer cleanup
  const cleanupTimers = () => {
    if (recordingTimer.current) {
      clearTimeout(recordingTimer.current)
      recordingTimer.current = null
    }
    if (recordingTimeInterval.current) {
      clearInterval(recordingTimeInterval.current)
      recordingTimeInterval.current = null
    }
    if (timerInterval.current) {
      clearInterval(timerInterval.current)
      timerInterval.current = null
    }
  }

  // Camera mode is now mostly static (video mode) - minimal effect needed
  React.useEffect(() => {

    // Camera will handle mode internally, no artificial delays needed
  }, [cameraMode])

  // Enhanced Android-optimized picture taking with better error handling
  const takePicture = useCallback(async () => {
    if (!cameraRef.current || !isCameraReady || isRecordingActive || isCapturingPhoto || isModeSwitching) {
      console.log('❌ Camera not ready, already recording, capturing photo, or switching modes')
      return
    }

    setIsCapturingPhoto(true) // Prevent multiple simultaneous captures

    try {
      console.log('📸 [CAMERA] Starting enhanced picture capture...')
      
      // Android: Ensure we're in picture mode before capture
      if (Platform.OS === 'android' && cameraMode !== 'picture') {
        console.log('🤖 [CAMERA] Switching to picture mode before capture')
        setIsModeSwitching(true)
        setCameraMode('picture')
        await new Promise(resolve => setTimeout(resolve, 300)) // Wait for mode switch
        setIsModeSwitching(false)
      }
      
      // Immediate haptic feedback for responsiveness
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
      // Optimized capture options for maximum quality and minimal compression
      const captureOptions = Platform.OS === 'android' ? {
        quality: 1.0, // Maximum quality to preserve original image data
        base64: false,
        skipProcessing: false, // Important: false pour garder l'exif
        exif: true, // Important pour avoir les infos d'orientation
        imageType: 'jpg',
        shutterSound: false,
        mirror: false,
        // Android: Enhanced stability and quality settings
        fastMode: false, // Disable fast mode for better stability
        fixOrientation: true, // Let camera handle orientation
        forceUpOrientation: false, // Don't force orientation changes
        // Quality preservation settings
        compress: 0.95, // Minimal compression during capture
      } : {
        quality: 1.0, // Maximum quality for iOS as well
        base64: false,
        skipProcessing: false, // Important: false pour garder l'exif
        exif: true, // Important pour avoir les infos d'orientation
        shutterSound: false,
        mirror: false,
        // iOS: Enhanced quality settings
        compress: 0.95, // Minimal compression during capture
        // Disable iOS auto-enhancement/processing
        autoRedEyeReduction: false, // Disable automatic red-eye correction
        isImageMirror: false, // Prevent unwanted mirroring
      }
      console.log(`${Platform.OS === 'android' ? '🤖' : '🍎'} [CAMERA] Taking picture with enhanced options:`, captureOptions)
      
      // Enhanced capture with better timeout and error handling
      const capturePromise = cameraRef.current.takePictureAsync(captureOptions)
      const timeoutDuration = Platform.OS === 'android' ? 20000 : 15000 // Longer timeout for Android
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Photo capture timeout - camera may be busy or unresponsive')), timeoutDuration)
      })
      
      const photo = await Promise.race([capturePromise, timeoutPromise])
      console.log('📷 Photo capture result:', { 
        hasUri: !!photo?.uri, 
        width: photo?.width,
        height: photo?.height,
        size: photo?.uri ? 'Available' : 'Missing',
        exif: photo?.exif
      })
      if (!photo?.uri) {
        throw new Error('No photo URI returned from camera')
      }
      let finalPhotoUri = photo.uri
      
      // Vérification EXIF orientation
      const orientation = photo.exif?.Orientation;
      console.log('📐 EXIF Orientation:', orientation)

      // Rotation en fonction de l'orientation EXIF
      // Basé sur les observations réelles du device :
      // Portrait normal = 6, 90° CW = 3, Upside down = 8, -90° CW = 1
      // Sur Android, la caméra frontale a une rotation inversée
      let rotateAngle = 0;
      const isAndroidFrontCamera = Platform.OS === 'android' && type === 'front';

      switch (orientation) {
        case 6: // Portrait normal
          rotateAngle = isAndroidFrontCamera ? 180 : 0; // Inversé pour front camera Android
          break;
        case 3: // 90° sens horaire
          rotateAngle = isAndroidFrontCamera ? 90 : -90; // Inversé pour front camera Android
          break;
        case 8: // Upside down (180°)
          rotateAngle = isAndroidFrontCamera ? 0 : 180; // Inversé pour front camera Android
          break;
        case 1: // -90° sens horaire
          rotateAngle = isAndroidFrontCamera ? -90 : 90; // Inversé pour front camera Android
          break;
        default:
          rotateAngle = 0;
          break;
      }

      // Si une rotation est nécessaire, applique-la avec compression optimale
      if (rotateAngle !== 0) {
        const manipulated = await ImageManipulator.manipulateAsync(
          photo.uri,
          [{ rotate: rotateAngle }],
          { 
            compress: 0.95, // Higher quality for rotation step
            format: ImageManipulator.SaveFormat.JPEG,
            base64: false
          }
        );
        finalPhotoUri = manipulated.uri;
        console.log(`🔄 Image rotated by ${rotateAngle}° based on EXIF (was orientation ${orientation})${isAndroidFrontCamera ? ' [Android front camera correction applied]' : ''}`);
      } else {
        console.log(`✅ Image orientation OK, no rotation needed (EXIF: ${orientation})${isAndroidFrontCamera ? ' [Android front camera]' : ''}`);
      }
      // Immediate UI feedback
      setCapturedMedia(finalPhotoUri)
      setMediaType('photo')
      setCapturedFromFrontCamera(type === 'front')
      // Success haptic feedback
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (error) {
      console.error('💥 [CAMERA] Error taking picture:', error)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      
      // Enhanced error handling with specific messages
      let errorMessage = 'Impossible de prendre la photo. Réessayez.'
      
      if (Platform.OS === 'android') {
        if (error.message?.includes('timeout')) {
          errorMessage = 'Capture trop lente. Vérifiez que la caméra n\'est pas utilisée par une autre app.'
        } else if (error.message?.includes('busy') || error.message?.includes('occupied')) {
          errorMessage = 'Caméra occupée. Fermez les autres apps utilisant la caméra et réessayez.'
        } else if (error.message?.includes('permission')) {
          errorMessage = 'Permissions caméra insuffisantes. Vérifiez les paramètres.'
        } else {
          errorMessage = 'Erreur caméra Android. Redémarrez l\'app si le problème persiste.'
        }
      }
      
      Alert.alert('Erreur de capture', errorMessage)
    } finally {
      setIsCapturingPhoto(false)
      setIsModeSwitching(false)
    }
  }, [isCameraReady, isRecordingActive, isCapturingPhoto, isModeSwitching, cameraMode, type])

  // Optimized media mode cycling with enhanced haptics
  const cycleMediaMode = useCallback(() => {
    const modes = ['permanent', 'one_time', 'nsfw']
    const currentIndex = modes.indexOf(mediaMode)
    const nextIndex = (currentIndex + 1) % modes.length
    setMediaMode(modes[nextIndex])
    
    // Different haptic feedback for different modes
    if (modes[nextIndex] === 'nsfw') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
    } else if (modes[nextIndex] === 'one_time') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    }
  }, [mediaMode])

  // Timer functionality
  const cycleTimer = useCallback(() => {
    if (isTimerActive || isRecording || isRecordingActive) {
      // Don't allow timer changes while counting down or recording
      return
    }
    
    const timers = [0, 5, 10]
    const currentIndex = timers.indexOf(timerSeconds)
    const nextIndex = (currentIndex + 1) % timers.length
    setTimerSeconds(timers[nextIndex])
    
    // Haptic feedback based on timer value
    if (timers[nextIndex] === 0) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    } else if (timers[nextIndex] === 5) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
    }
  }, [timerSeconds, isTimerActive, isRecording, isRecordingActive])

  const startTimerCountdown = useCallback(() => {
    if (timerSeconds === 0) {
      // No timer, take photo immediately
      takePicture()
      return
    }

    setIsTimerActive(true)
    setTimerCountdown(timerSeconds)
    
    // Initial haptic feedback
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
    
    timerInterval.current = setInterval(() => {
      setTimerCountdown(prev => {
        if (prev <= 1) {
          // Timer finished, take photo
          clearInterval(timerInterval.current)
          timerInterval.current = null
          setIsTimerActive(false)
          
          // Final haptic feedback and take photo
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          setTimeout(() => takePicture(), 100) // Small delay for better UX
          
          return 0
        } else {
          // Countdown tick
          if (prev <= 3) {
            // Final 3 seconds get stronger haptic feedback
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
          } else {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
          }
          return prev - 1
        }
      })
    }, 1000)
  }, [timerSeconds, takePicture])

  const cancelTimer = useCallback(() => {
    if (timerInterval.current) {
      clearInterval(timerInterval.current)
      timerInterval.current = null
    }
    setIsTimerActive(false)
    setTimerCountdown(0)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }, [])

  // Memoized media mode info
  const getMediaModeInfo = useCallback(() => {
    switch (mediaMode) {
      case 'permanent':
        return { icon: 'infinite', emoji: '♾️', label: 'Permanent' }
      case 'one_time':
        return { icon: 'eye', emoji: '👁️', label: 'Vue unique' }
      case 'nsfw':
        return { icon: 'flame', emoji: '🔥', label: 'Éphémère' }
      default:
        return { icon: 'infinite', emoji: '♾️', label: 'Permanent' }
    }
  }, [mediaMode])

  // Smart press handler with support for both photo and video modes
  const handlePress = useCallback(() => {
    // Don't allow starting new actions if already capturing photo or timer is active
    if (!isCameraReady || isCapturingPhoto || isTimerActive) {
      console.log('❌ Cannot capture:', {
        cameraReady: isCameraReady,
        capturingPhoto: isCapturingPhoto,
        timerActive: isTimerActive
      })
      return
    }

    if (recordingMode === 'photo') {
      // Don't take photo if already recording video
      if (isRecording || isRecordingActive) {
        console.log('❌ Cannot take photo while recording video')
        return
      }
      // Use timer for photo capture
      startTimerCountdown()
    } else if (recordingMode === 'video') {
      // Toggle video recording - start if not recording, stop if recording
      if (!isRecordingActive) {
        startVideoRecording()
      } else {
        stopRecording()
      }
    }
  }, [isCameraReady, isRecording, isRecordingActive, isCapturingPhoto, isTimerActive, recordingMode, startTimerCountdown, startVideoRecording, stopRecording])

  // Enhanced press handlers with better state management and error prevention
  const handlePressIn = useCallback(() => {
    if (!isCameraReady || isRecordingActive || isModeSwitching || isCapturingPhoto) return
    
    // Initial haptic feedback
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    
    // Set up long press timer with enhanced platform-specific session management
    longPressTimer.current = setTimeout(async () => {
      // Triple-check that we're still in a valid state for recording
      if (!isRecordingActive && isCameraReady && !isModeSwitching && !isCapturingPhoto) {
        setIsLongPressing(true)
        
        // Platform-specific video session preparation
        if (Platform.OS === 'android') {
          // Android: Switch from picture to video mode during long press delay
          console.log('🤖 [CAMERA] Android: Preparing video session during long press')
          setIsModeSwitching(true)
          setCameraMode('video')
          // Extended wait for Android mode switch to complete properly
          await new Promise(resolve => setTimeout(resolve, 250))
          setIsModeSwitching(false)
        } else {
          // iOS: Already in video mode, no switching needed
          console.log('🍎 [CAMERA] iOS: Already in video mode, starting recording')
        }
        
        // Final check before starting recording
        if (isCameraReady && !isRecordingActive) {
          // Stronger haptic for video start
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
          startRecording()
        }
      }
    }, 600) // 600ms delay before starting video - we hide Android session switch in this gap
  }, [isCameraReady, isRecordingActive, isModeSwitching, isCapturingPhoto, startRecording])

  const handlePressOut = useCallback(() => {
    // Clear the long press timer if it's still running
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    
    // If we were in long press mode and recording, stop recording
    // But only if recording has been active for at least the minimum time
    if (isLongPressing && isRecordingActive) {
      const elapsed = Date.now() - recordStart.current
      
      // If recording just started, wait a bit longer before allowing stop
      if (elapsed < MIN_VIDEO_MS) {
        // Don't stop immediately, let it record for minimum time
        setTimeout(() => {
          if (isRecordingActive) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
            stopRecording()
          }
        }, MIN_VIDEO_MS - elapsed + 100) // Add small buffer
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        stopRecording()
      }
    }
    
    // Reset long press state
    setIsLongPressing(false)
  }, [isLongPressing, isRecordingActive, stopRecording, MIN_VIDEO_MS])
  
  const handleRecordingFinished = useCallback((video) => {
    
    // First set recording state to false
    resetRecordingState()

    
    // Then check if we have a valid video
    if (video?.uri) {
      // Process front camera video mirroring for consistency
      const processVideo = async () => {
        let finalVideoUri = video.uri
        
        try {
          // Show compression loading
          setLoading(true)
          setLoadingStage('Compression de la vidéo...')
          setCompressionProgress(0)
          
          // Get video metadata for optimization insights
          try {
            const metadata = await getVideoMetadata(video.uri)
            console.log('📊 Video metadata:', {
              size: metadata.sizeMB + 'MB',
              duration: metadata.duration + 's',
              dimensions: `${metadata.width}x${metadata.height}`,
              aspectRatio: metadata.aspectRatio
            })
          } catch (metadataError) {
            console.warn('⚠️ Could not get video metadata:', metadataError)
          }
          
          // Enhanced quality video compression with smart optimization
          console.log('🗜️ Starting enhanced quality video compression...')
          finalVideoUri = await compressVideoAuto(video.uri, {
            onProgress: (progress) => {
              console.log(`📊 Video compression: ${progress}%`)
              setCompressionProgress(progress)
              setLoadingStage(`Optimisation vidéo... ${Math.round(progress)}%`)
            },
            targetSizeMB: 8, // Higher target for better quality: 8MB max
            qualityPreference: 'quality', // Prioritize quality preservation
            enableBackgroundTask: true // Allow compression in background
          })
          console.log('✅ Production video compression completed')
          
          // Clear loading states
          setLoading(false)
          setLoadingStage('')
          setCompressionProgress(0)
          
        } catch (compressionError) {
          console.warn('⚠️ Video compression failed, using original:', compressionError)
          finalVideoUri = video.uri // Fallback to original
          setLoading(false)
          setLoadingStage('')
          setCompressionProgress(0)
        }
        
        if (type === 'front') {
          try {
            console.log('🔄 Processing front camera video mirror correction...')
            // For videos, we need to handle mirroring differently
            // Note: Video mirroring is more complex and may require ffmpeg
            // For now, we'll set a flag to handle it in the preview
            console.log('📹 Front camera video - will handle mirroring in preview')
          } catch (mirrorError) {
            console.warn('⚠️ Video mirror processing not available:', mirrorError)
          }
        }
        
        // Set the captured media immediately
        setCapturedMedia(finalVideoUri)
        setMediaType('video')
        setCapturedVideoMuted(isRecordingMuted) // Set preview mute state based on recording state
        setCapturedFromFrontCamera(type === 'front')
      }
      
      processVideo()
      
      // Platform-specific mode reset: Only Android returns to picture mode
      if (Platform.OS === 'android') {
        setTimeout(() => {
          setCameraMode('picture')
        }, 100)
      }
      // iOS stays in video mode

    } else {
      console.error('❌ No video URI in result:', video)
      console.error('🔍 Full video object:', JSON.stringify(video, null, 2))
      Alert.alert('Erreur', 'Aucune vidéo enregistrée')
    }
  }, [isRecordingMuted, type])

  const handleRecordingError = useCallback((error) => {
    console.error('🚨 handleRecordingError called with:', error)
    console.error('🔍 Error details:', {
      message: error?.message,
      code: error?.code,
      domain: error?.domain,
      stack: error?.stack
    })
    
    // Clean up recording promise if it exists
    if (recordingPromiseRef.current) {
      recordingPromiseRef.current = null
    }
    
    // Reset all recording state
    resetRecordingState()
    
    // Platform-specific mode reset: Only Android returns to picture mode
    if (Platform.OS === 'android') {
      setTimeout(() => {
        setCameraMode('picture')
      }, 100)
    }
    // iOS stays in video mode
    
    // Handle specific Android recording errors
    if (error?.message?.includes('Recording was stopped before any data could be produced')) {
      Alert.alert(
        'Enregistrement trop court',
        'Maintenez le bouton appuyé plus longtemps pour enregistrer une vidéo (minimum 2 secondes).',
        [{ text: 'OK' }]
      )
    } else if (error?.message?.includes('Missing permissions')) {
      Alert.alert(
        'Permissions manquantes',
        'Veuillez accorder les permissions caméra et microphone dans les paramètres.',
        [{ text: 'OK' }]
      )
    } else {
      Alert.alert('Erreur', `Enregistrement échoué: ${error?.message || 'Erreur inconnue'}`)
    }
  }, [])

  // Enhanced recording start function with better state management
  const startRecording = useCallback(async () => {
    if (!cameraRef.current || !isCameraReady || isRecordingActive || isModeSwitching) {
      console.log('❌ [CAMERA] Cannot start recording: invalid state')
      return
    }

    try {
      console.log('🎬 [CAMERA] Starting recording with enhanced stability...')
      
      // Ensure camera is in video mode (especially for Android)
      if (Platform.OS === 'android' && cameraMode !== 'video') {
        console.log('🤖 [CAMERA] Final mode check: switching to video mode')
        setIsModeSwitching(true)
        setCameraMode('video')
        await new Promise(resolve => setTimeout(resolve, 200))
        setIsModeSwitching(false)
      }
      
      // Set recording state immediately
      recordStart.current = Date.now()
      setIsRecordingActive(true)
      setIsRecording(true)
      setRecordingTime(0)
      
      // Enhanced haptic feedback for recording start
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
      
      // Start display timer
      recordingTimeInterval.current = setInterval(() => {
        setRecordingTime(prev => prev + 0.1)
      }, 100)
      
      // Animate progress circle for 60 seconds max recording
      recordingProgress.setValue(0)
      Animated.timing(recordingProgress, {
        toValue: 1,
        duration: 60000, // 60 seconds max recording
        useNativeDriver: false,
      }).start()
      
      // Enhanced recording options with validated properties only
      const recordingOptions = Platform.OS === 'android' ? {
        maxDuration: 60,
        mute: false,
        quality: 'high', // Valid quality enum value
        // Remove potentially invalid props that cause crashes
        // Keep only core supported properties for Android
        mirror: type === 'front',
      } : {
        maxDuration: 60,
        mute: false,
        quality: 'high', // Valid quality enum value
        // Keep only core supported properties for iOS
        mirror: type === 'front',
      }
      
      console.log(`${Platform.OS === 'android' ? '🤖' : '🍎'} [CAMERA] Starting recording with options:`, recordingOptions)
      recordingPromiseRef.current = cameraRef.current.recordAsync(recordingOptions)
        
    } catch (error) {
      console.error('🔥 [CAMERA] Error in startRecording:', error)
      // Clean up states on error
      setIsModeSwitching(false)
      handleRecordingError(error)
    }
  }, [isCameraReady, isRecordingActive, isModeSwitching, cameraMode, handleRecordingError, type])

  // New dedicated video recording function for tap-to-record mode
  const startVideoRecording = useCallback(async () => {
    if (!cameraRef.current || !isCameraReady || isRecordingActive) {
      return
    }

    try {
      // Switch to video mode if needed
      if (cameraMode !== 'video') {
        setCameraMode('video')
        await new Promise(resolve => setTimeout(resolve, 100)) // Brief delay for mode switch
      }
      
      // Set recording state immediately
      recordStart.current = Date.now()
      setIsRecordingActive(true)
      setIsRecording(true)
      setRecordingTime(0)
      
      // Enhanced haptic feedback for recording start
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
      
      // Start display timer
      recordingTimeInterval.current = setInterval(() => {
        setRecordingTime(prev => prev + 0.1)
      }, 100)
      
      // Animate progress circle for 60 seconds max recording
      recordingProgress.setValue(0)
      Animated.timing(recordingProgress, {
        toValue: 1,
        duration: 60000, // 60 seconds max recording
        useNativeDriver: false,
      }).start()
      
      // Enhanced recording options with validated properties only
      const recordingOptions = Platform.OS === 'android' ? {
        maxDuration: 60,
        mute: isRecordingMuted,
        quality: 'high', // Valid enum value
        // Remove potentially invalid props - keep only core supported ones
        mirror: type === 'front',
      } : {
        maxDuration: 60,
        mute: isRecordingMuted,
        quality: 'high', // Valid enum value
        mirror: type === 'front',
        // iOS may support additional properties, but keeping minimal for reliability
      }
      
      recordingPromiseRef.current = cameraRef.current.recordAsync(recordingOptions)
        
    } catch (error) {
      console.error('🔥 Error in startVideoRecording:', error)
      handleRecordingError(error)
    }
  }, [isCameraReady, isRecordingActive, isRecordingMuted, cameraMode, handleRecordingError, type])

  // Enhanced robust recording stop function with better error recovery
  const stopRecording = useCallback(async () => {
    if (!cameraRef.current || !isRecordingActive) {
      console.log('❌ [CAMERA] Cannot stop recording: camera ref missing or not recording')
      return
    }

    try {
      console.log('⏹️ [CAMERA] Stopping recording with enhanced error handling...')
      
      // Ensure encoder had enough time (minimum duration)
      const elapsed = Date.now() - recordStart.current
      
      if (elapsed < MIN_VIDEO_MS) {
        const waitTime = MIN_VIDEO_MS - elapsed + 200 // Add extra buffer for Android
        console.log(`📹 [CAMERA] Waiting ${waitTime}ms for minimum recording time...`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
      
      // Clear intervals and stop animations first
      if (recordingTimeInterval.current) {
        clearInterval(recordingTimeInterval.current)
        recordingTimeInterval.current = null
      }
      recordingProgress.stopAnimation()
      recordingProgress.setValue(0)
      
      // Enhanced haptic feedback for recording stop
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      
      // Enhanced stop recording with better error handling
      try {
        if (cameraRef.current && typeof cameraRef.current.stopRecording === 'function') {
          await cameraRef.current.stopRecording()
          console.log('✅ [CAMERA] Successfully called stopRecording')
        } else {
          console.warn('⚠️ [CAMERA] stopRecording method not available on camera ref')
        }
      } catch (stopError) {
        console.error('⚠️ [CAMERA] Error calling stopRecording:', stopError)
        // Don't throw here, the promise might still resolve
      }
      
      // Check if we have a valid recording promise
      if (!recordingPromiseRef.current) {
        throw new Error('No recording promise available - recording may have failed to start')
      }
      
      // Wait for recording to complete with timeout for safety
      const recordingTimeout = Platform.OS === 'android' ? 10000 : 5000 // Longer timeout for Android
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Recording stop timeout')), recordingTimeout)
      })
      
      const video = await Promise.race([recordingPromiseRef.current, timeoutPromise])
      
      recordingPromiseRef.current = null
      
      // Validate video result
      if (!video || !video.uri) {
        throw new Error('Invalid video result - no URI provided')
      }
      
      console.log('✅ [CAMERA] Video recording completed successfully:', video.uri)
      handleRecordingFinished(video)
      
    } catch (error) {
      console.error('💥 [CAMERA] Error stopping recording:', error)
      handleRecordingError(error)
    }
  }, [isRecordingActive, handleRecordingFinished, handleRecordingError, MIN_VIDEO_MS])

  const resetRecordingState = useCallback(() => {
    setIsRecording(false)
    setIsRecordingActive(false)
    setRecordingTime(0)
    
    cleanupTimers()
    
    recordingProgress.stopAnimation()
    recordingProgress.setValue(0)
    
    if (recordingPromiseRef.current) {
      recordingPromiseRef.current = null
    }
  }, [])

  // Ultra-optimized media sending with better progress and error handling
  const sendMedia = useCallback(async () => {
    if (!capturedMedia) return

    setLoading(true)
    try {
      // Get current user from AuthContext - no API call needed
      setLoadingStage('Préparation...')
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié')
      }

      // Immediate user feedback
      const startTime = Date.now()
      console.log(`🚀 Starting optimized upload: ${currentUser.pseudo} → ${otherUser?.pseudo}`)

      // Optimize and process media before upload for faster transfer
      let optimizedMediaUri = capturedMedia
      
      // Handle front camera mirroring for photos only
      if (capturedFromFrontCamera && mediaType === 'photo') {
        setLoadingStage('Traitement miroir...')
        
        try {
          console.log('🔄 Processing front camera photo mirror correction for upload...')
          const manipulatedImage = await ImageManipulator.manipulateAsync(
            capturedMedia,
            [{ flip: ImageManipulator.FlipType.Horizontal }],
            { 
              compress: 0.9, 
              format: ImageManipulator.SaveFormat.JPEG,
              base64: false 
            }
          )
          optimizedMediaUri = manipulatedImage.uri
          console.log('✅ Front camera photo mirror correction applied for upload')
        } catch (mirrorError) {
          console.warn('⚠️ Failed to apply photo mirror correction for upload:', mirrorError)
        }
      }
      
      if (mediaType === 'photo') {
        setLoadingStage('Optimisation...')
        const originalInfo = await getImageInfo(optimizedMediaUri)
        console.log(`📸 Original photo: ${originalInfo?.sizeMB}MB`)
        
        optimizedMediaUri = await optimizeImageForUpload(optimizedMediaUri, mediaType)
        
        if (optimizedMediaUri !== capturedMedia) {
          const optimizedInfo = await getImageInfo(optimizedMediaUri)
          console.log(`✨ Optimized photo: ${optimizedInfo?.sizeMB}MB`)
        }
      } else {
        // PRODUCTION VIDEO COMPRESSION for maximum egress reduction
        setLoadingStage('Compression vidéo...')
        console.log('🎬 [CAMERA] Starting production video compression for maximum size reduction')
        
        try {
          // Get original size for comparison
          const originalInfo = await FileSystem.getInfoAsync(optimizedMediaUri)
          const originalSizeMB = originalInfo.size / (1024 * 1024)
          console.log(`📹 [CAMERA] Original video: ${originalSizeMB.toFixed(2)}MB`)
          
          // Apply enhanced quality compression with progress tracking
          const compressedUri = await compressVideoAuto(optimizedMediaUri, {
            onProgress: (progress) => {
              setLoadingStage(`Optimisation vidéo... ${Math.round(progress)}%`)
            },
            targetSizeMB: 6, // Balanced target for upload: 6MB max
            qualityPreference: 'quality', // Quality preservation
            enableBackgroundTask: true
          })
          
          if (compressedUri !== optimizedMediaUri) {
            // Compression succeeded, use compressed version
            const compressedInfo = await FileSystem.getInfoAsync(compressedUri)
            const compressedSizeMB = compressedInfo.size / (1024 * 1024)
            const reduction = ((originalSizeMB - compressedSizeMB) / originalSizeMB * 100).toFixed(1)
            
            console.log(`✅ [CAMERA] Production video compressed: ${originalSizeMB.toFixed(2)}MB → ${compressedSizeMB.toFixed(2)}MB (${reduction}% reduction)`)
            optimizedMediaUri = compressedUri
          } else {
            console.log('ℹ️ [CAMERA] Video compression skipped or failed, using original')
          }
        } catch (compressionError) {
          console.warn('⚠️ [CAMERA] Video compression failed:', compressionError)
          // Continue with original video if compression fails
        }
        
        setLoadingStage('Préparation vidéo...')
      }

      // Platform-specific optimization hints
      if (Platform.OS === 'android') {
        console.log('🤖 Android: Using background upload mode')
      } else {
        console.log('🍎 iOS: Using background upload mode')
      }

      setLoadingStage('Envoi...')
      
      // Fast message sending with background upload
      const targetUserId = otherUserId || otherUser?.id
      if (!targetUserId) {
        throw new Error('Utilisateur destinataire non trouvé')
      }
      
      // Queue message for background upload and sending with optimistic UI
      const tempId = await backgroundMessageService.queueMessage({
        receiverId: targetUserId,
        localMediaUri: optimizedMediaUri, // Pass local URI for background upload
        mediaType,
        caption: caption.trim() || null,
        mediaMode,
        isMuted: mediaType === 'video' ? capturedVideoMuted : false,
        currentUser,
        otherUser
      })

      const totalTime = Date.now() - startTime
      console.log(`🎉 Message queued for background upload & send in ${totalTime}ms, tempId: ${tempId}`)

      // Success feedback
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      
      // Immediate navigation - upload happens in background
      router.back()
      
    } catch (error) {
      console.error('💥 Send media error:', error)
      
      // Better error messages
      let errorMessage = 'Impossible de préparer le média'
      
      if (error.message?.includes('session')) {
        errorMessage = 'Erreur d\'authentification. Redémarrez l\'app.'
      } else if (error.message?.includes('storage')) {
        errorMessage = 'Erreur de stockage. Réessayez.'
      }
      
      Alert.alert('Erreur', errorMessage)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    } finally {
      setLoading(false)
      setLoadingStage('')
    }
  }, [capturedMedia, mediaType, mediaMode, caption, otherUser, currentUser, otherUserId, capturedVideoMuted])

  // Toggle between photo and video recording modes
  const toggleRecordingMode = useCallback(() => {
    const newMode = recordingMode === 'photo' ? 'video' : 'photo'
    setRecordingMode(newMode)
    
    // Switch camera mode accordingly for optimal performance
    if (newMode === 'video' && cameraMode !== 'video') {
      setCameraMode('video')
    } else if (newMode === 'photo' && cameraMode !== 'picture') {
      setCameraMode('picture')
    }
    
    // Haptic feedback
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    
    if (__DEV__) {
      console.log(`📹 [CAMERA] Switched to ${newMode} mode`)
    }
  }, [recordingMode, cameraMode])

  // Toggle audio recording on/off
  const toggleRecordingMute = useCallback(() => {
    setIsRecordingMuted(prev => {
      const newMutedState = !prev
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      
      if (__DEV__) {
        console.log(`🔊 [CAMERA] Audio recording ${newMutedState ? 'muted' : 'unmuted'}`)
      }
      
      return newMutedState
    })
  }, [])

  const resetCapture = useCallback(() => {
    // Pause video player if it exists
    if (videoPlayer && mediaType === 'video') {
      videoPlayer.pause()
    }
    
    // Cancel any active timer
    cancelTimer()
    
    setCapturedMedia(null)
    setMediaType(null)
    setCaption('')
    setCapturedVideoMuted(false) // Reset video mute state
    setCapturedFromFrontCamera(false) // Reset front camera flag
    resetRecordingState()
    
    // Platform-specific mode reset: Only Android returns to picture mode
    if (Platform.OS === 'android') {
      setCameraMode('picture')
    }
    // iOS stays in video mode
    
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }, [videoPlayer, mediaType, resetRecordingState, cancelTimer])

  // Keyboard handling effect
  React.useEffect(() => {
    let keyboardShowListener, keyboardHideListener
    
    if (Platform.OS === 'android') {
      // Android: Use different events and prevent rapid show/hide cycles
      keyboardShowListener = Keyboard.addListener('keyboardDidShow', (event) => {
        console.log('⌨️ Android Keyboard showing, height:', event.endCoordinates.height)
        // Debounce keyboard height changes to prevent rapid cycles
        setTimeout(() => {
          setKeyboardHeight(event.endCoordinates.height)
        }, 50)
      })
      
      keyboardHideListener = Keyboard.addListener('keyboardDidHide', () => {
        console.log('⌨️ Android Keyboard hiding')
        // Debounce hide to prevent rapid cycles
        setTimeout(() => {
          setKeyboardHeight(0)
        }, 50)
      })
    } else {
      // iOS: Use will events for smoother animation
      keyboardShowListener = Keyboard.addListener('keyboardWillShow', (event) => {
        console.log('⌨️ iOS Keyboard showing, height:', event.endCoordinates.height)
        setKeyboardHeight(event.endCoordinates.height)
      })
      
      keyboardHideListener = Keyboard.addListener('keyboardWillHide', () => {
        console.log('⌨️ iOS Keyboard hiding')
        setKeyboardHeight(0)
      })
    }

    return () => {
      keyboardShowListener?.remove()
      keyboardHideListener?.remove()
    }
  }, [])

  if (!permission || !microphonePermission) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Initialisation de la caméra...</Text>
        </View>
      </View>
    )
  }

  if (!permission.granted || !microphonePermission.granted) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#0f0f0f', '#1a1a1a']}
          style={styles.background}
        >
          <Text style={styles.noPermissionText}>
            Accès à la caméra et au microphone requis
          </Text>
          <TouchableOpacity
            style={styles.requestButton}
            onPress={requestPermission}
          >
            <Text style={styles.requestButtonText}>Autoriser</Text>
          </TouchableOpacity>
        </LinearGradient>
      </View>
    )
  }

  if (capturedMedia) {

    
    return (
      <View style={styles.previewContainer}>
        <AppStatusBar style="light" />
        
        {/* Affichage du média capturé - Fixed background */}
        {mediaType === 'photo' ? (
          <Image 
            source={{ uri: capturedMedia }}
            style={[
              styles.fullScreenMedia,
              // Mirror front camera photos in preview to match upload result
              capturedFromFrontCamera && { transform: [{ scaleX: -1 }] }
            ]}
            contentFit="cover"
          />
        ) : (
          <VideoView
            player={videoPlayer}
            style={styles.fullScreenMedia}
            nativeControls={false}
            allowsFullscreen={false}
            contentFit="cover"
          />
        )}

        {/* Video Mute Button Overlay - only show for captured videos */}
        {mediaType === 'video' && capturedMedia && (
          <TouchableOpacity
            style={styles.previewMuteButton}
            onPress={() => {
              setCapturedVideoMuted(prev => {
                const newMuted = !prev
                if (videoPlayer) {
                  videoPlayer.muted = newMuted
                }
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                return newMuted
              })
            }}
          >
            <Ionicons 
              name={capturedVideoMuted ? 'volume-mute' : 'volume-high'} 
              size={24} 
              color={Colors.white} 
            />
          </TouchableOpacity>
        )}

        {/* Minimal Header - Fixed position */}
        <View style={styles.mediaHeader}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              resetCapture()
            }}
          >
            <Ionicons name="arrow-back" size={24} color={Colors.white} />
          </TouchableOpacity>
          
          <Text style={styles.username}>
            À {otherUser?.pseudo}
          </Text>

          <View style={styles.backButton} />
        </View>

        {/* Fixed Send Interface with platform-specific keyboard handling */}
        {Platform.OS === 'ios' ? (
          <KeyboardAvoidingView
            behavior="padding"
            keyboardVerticalOffset={0}
            style={[styles.sendInterface]}
          >
            <View style={styles.sendInterfaceContent}>
              {/* Media mode toggle */}
              <View style={styles.topRow}>
                <TouchableOpacity
                  style={styles.sendMediaToggle}
                  onPress={cycleMediaMode}
                >
                  <View style={[styles.sendMediaToggleIcon, 
                    mediaMode === 'nsfw' && styles.sendMediaToggleIconNsfw,
                    mediaMode === 'one_time' && styles.sendMediaToggleIconOneTime
                  ]}>
                    <Ionicons 
                      name={getMediaModeInfo().icon} 
                      size={16} 
                      color={Colors.black} 
                    />
                  </View>
                  <Text style={styles.sendMediaToggleText}>
                    {getMediaModeInfo().label}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Caption Input */}
              <TextInput
                style={styles.captionInput}
                placeholder="Ajouter une légende (optionnel)..."
                placeholderTextColor={Colors.grayMedium}
                value={caption}
                onChangeText={setCaption}
                maxLength={500}
                multiline
                returnKeyType="done"
                blurOnSubmit={true}
                textAlignVertical="top"
                scrollEnabled={true}
              />

              {/* Send Actions */}
              <View style={styles.sendActions}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    resetCapture()
                  }}
                >
                  <Ionicons name="close" size={24} color={Colors.white} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.sendButton, loading && styles.sendButtonDisabled]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
                    sendMedia()
                  }}
                  disabled={loading}
                >
                  <Text style={styles.sendButtonText}>
                    {loading ? (loadingStage || 'Envoi...') : 'Envoyer'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        ) : (
          // Android: Stable positioning without transform conflicts
          <View style={[
            styles.sendInterface,
            styles.sendInterfaceAndroid,
            keyboardHeight > 0 && {
              marginBottom: keyboardHeight - 50 // Dynamic offset based on actual keyboard height
            }
          ]}>
            <View style={styles.sendInterfaceContent}>
              {/* Media mode toggle */}
              <View style={styles.topRow}>
                <TouchableOpacity
                  style={styles.sendMediaToggle}
                  onPress={cycleMediaMode}
                >
                  <View style={[styles.sendMediaToggleIcon, 
                    mediaMode === 'nsfw' && styles.sendMediaToggleIconNsfw,
                    mediaMode === 'one_time' && styles.sendMediaToggleIconOneTime
                  ]}>
                    <Ionicons 
                      name={getMediaModeInfo().icon} 
                      size={16} 
                      color={Colors.black} 
                    />
                  </View>
                  <Text style={styles.sendMediaToggleText}>
                    {getMediaModeInfo().label}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Caption Input */}
              <TextInput
                style={[styles.captionInput, styles.captionInputAndroid]}
                placeholder="Ajouter une légende (optionnel)..."
                placeholderTextColor={Colors.gray300}
                value={caption}
                onChangeText={setCaption}
                maxLength={500}
                multiline
                returnKeyType="done"
                blurOnSubmit={false}
                textAlignVertical="top"
                scrollEnabled={true}
                autoCorrect={false}
                autoCapitalize="sentences"
                keyboardType="default"
                onFocus={() => {
                  console.log('📝 Android TextInput focused - preventing blur')
                }}
                onBlur={() => {
                  console.log('📝 Android TextInput blurred')
                }}
                onSubmitEditing={() => {
                  console.log('📝 Android TextInput submitted')
                  Keyboard.dismiss()
                }}
              />

              {/* Send Actions */}
              <View style={styles.sendActions}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    resetCapture()
                  }}
                >
                  <Ionicons name="close" size={24} color={Colors.white} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.sendButton, loading && styles.sendButtonDisabled]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
                    sendMedia()
                  }}
                  disabled={loading}
                >
                  <Text style={styles.sendButtonText}>
                    {loading ? (loadingStage || 'Envoi...') : 'Envoyer'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </View>
    )
  }

  // Permission check screen
  if (!permission || !microphonePermission) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Vérification des permissions...</Text>
        </View>
      </View>
    )
  }

  if (!permission.granted || !microphonePermission.granted) {
    return (
      <View style={styles.container}>
        <View style={styles.permissionContainer}>
          <Ionicons name="camera-outline" size={64} color={Colors.gray400} />
          <Text style={styles.permissionTitle}>Permissions requises</Text>
          <Text style={styles.permissionText}>
            NoText a besoin d'accéder à votre caméra et microphone pour prendre des photos et vidéos.
          </Text>
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={async () => {
              try {
                const permissionPromises = []
                
                if (!permission?.granted) {
                  permissionPromises.push(requestPermission())
                }
                
                if (!microphonePermission?.granted) {
                  permissionPromises.push(requestMicrophonePermission())
                }
                
                if (permissionPromises.length > 0) {
                  const results = await Promise.all(permissionPromises)
                  const allGranted = results.every(result => result.granted)
                  
                  if (!allGranted) {
                    Alert.alert(
                      'Permissions refusées',
                      'Veuillez activer les permissions caméra et microphone dans les paramètres de votre appareil.'
                    )
                  }
                }
              } catch (error) {
                console.error('Error requesting permissions:', error)
                Alert.alert(
                  'Erreur',
                  'Impossible de demander les permissions. Veuillez les activer manuellement dans les paramètres.'
                )
              }
            }}
          >
            <Text style={styles.permissionButtonText}>Autoriser l'accès</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.backButtonAlt}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              router.back()
            }}
          >
            <Text style={styles.backButtonAltText}>Retour</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <AppStatusBar style="light" />
      
      {/* Status bar background for edge-to-edge mode */}
      {Platform.OS === 'android' && (
        <View style={styles.statusBarBackground} />
      )}
      
      {/* Gesture Handlers Wrapper */}
      <RNGHPinchGestureHandler
        ref={pinchGestureRef}
        onGestureEvent={handlePinchGesture}
        onHandlerStateChange={handlePinchGesture}
      >
        <Animated.View style={styles.gestureContainer}>
          <TapGestureHandler
            ref={doubleTapRef}
            onHandlerStateChange={handleDoubleTap}
            numberOfTaps={2}
            waitFor={[pinchGestureRef]}
          >
            <Animated.View style={styles.gestureContainer}>
              <CameraView 
                style={[
                  styles.camera,
                  // Android-specific visual fixes for full screen capture
                  Platform.OS === 'android' && {
                    alignSelf: 'center', // Center the camera view
                    backgroundColor: '#000000', // Prevent white borders
                    // Ensure full screen coverage
                    width: '100%',
                    height: '100%',
                  }
                ]}
                facing={type}
                mode={cameraMode}
                zoom={zoom}
                ref={cameraRef}
                // Ultra-minimal CameraView props - only essential validated ones
                flash="off"
                // Remove autofocus prop since it might expect boolean, not string
                // Keep only the most basic props that are guaranteed to work
                // All quality/feature settings handled at capture/record time
                onCameraReady={() => {
                  console.log('📷 [CAMERA] Camera ready callback triggered!')
                  if (!isCameraReady) {
                    console.log(`${Platform.OS === 'android' ? '🤖' : '🍎'} [CAMERA] Camera ready with enhanced settings!`)
                    setCameraError(null) // Clear any previous errors
                    setIsCameraReady(true)
                  }
                }}
                onMountError={(error) => {
                  console.error('📷 [CAMERA] Camera mount error:', error)
                  setCameraError(error)
                  setIsCameraReady(false)
                  
                  // Enhanced error messaging
                  let errorMessage = 'Impossible d\'initialiser la caméra.'
                  let actionMessage = 'Réessayez'
                  
                  if (Platform.OS === 'android') {
                    if (error.message?.includes('permission')) {
                      errorMessage = 'Permissions caméra manquantes. Vérifiez les paramètres de l\'app.'
                      actionMessage = 'Paramètres'
                    } else if (error.message?.includes('busy') || error.message?.includes('occupied')) {
                      errorMessage = 'Caméra utilisée par une autre application. Fermez les autres apps utilisant la caméra.'
                      actionMessage = 'Réessayer'
                    } else {
                      errorMessage = `Erreur caméra Android: ${error.message || 'Erreur inconnue'}`
                      actionMessage = 'Redémarrer'
                    }
                  }
                  
                  Alert.alert(
                    'Erreur caméra', 
                    errorMessage,
                    [
                      { text: 'Retour', style: 'cancel', onPress: () => router.back() },
                      { text: actionMessage, onPress: () => {
                        // Attempt to reinitialize camera
                        setTimeout(() => {
                          initializeCamera()
                        }, 1000)
                      }}
                    ]
                  )
                }}
              />
            </Animated.View>
          </TapGestureHandler>
        </Animated.View>
      </RNGHPinchGestureHandler>
      
      
      {/* Camera Loading Overlay */}
      {!isCameraReady && !cameraError && (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Préparation de la caméra...</Text>
        </View>
      )}
      
      {/* Camera Error Overlay */}
      {cameraError && (
        <View style={styles.errorContainer}>
          <Ionicons name="camera-outline" size={64} color={Colors.gray400} />
          <Text style={styles.errorTitle}>Erreur caméra</Text>
          <Text style={styles.errorText}>
            {Platform.OS === 'android' 
              ? 'La caméra ne peut pas être initialisée. Cela peut arriver si une autre app utilise la caméra ou si les permissions sont insuffisantes.'
              : 'Impossible d\'accéder à la caméra. Vérifiez les permissions dans les réglages.'
            }
          </Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setCameraError(null)
              initializeCamera()
            }}
          >
            <Ionicons name="refresh" size={20} color={Colors.white} />
            <Text style={styles.retryButtonText}>Réessayer</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.backButtonError}
            onPress={() => router.back()}
          >
            <Text style={styles.backButtonErrorText}>Retour</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Zoom Indicator */}
      {zoom > 0 && (
        <View style={styles.zoomIndicator}>
          <Text style={styles.zoomText}>
            {(zoom * 10 + 1).toFixed(1)}x
          </Text>
        </View>
      )}

      {/* Zoom Reset Button */}
      {zoom > 0.1 && !isRecording && !isTimerActive && (
        <TouchableOpacity style={styles.zoomResetButton} onPress={resetZoom}>
          <Ionicons name="refresh" size={20} color={Colors.white} />
          <Text style={styles.zoomResetText}>1x</Text>
        </TouchableOpacity>
      )}

      {/* Timer Countdown Overlay */}
      {isTimerActive && timerCountdown > 0 && (
        <View style={styles.timerCountdownOverlay}>
          <Text style={styles.timerCountdownText}>{timerCountdown}</Text>
          <TouchableOpacity style={styles.timerCancelButton} onPress={cancelTimer}>
            <Ionicons name="close" size={24} color={Colors.white} />
          </TouchableOpacity>
        </View>
      )}

      {/* Top Overlay */}
      <View style={styles.topOverlay}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
            router.back()
          }}
        >
          <Ionicons name="arrow-back" size={24} color={Colors.white} />
        </TouchableOpacity>
        
        <Text style={styles.username}>
          {otherUser?.pseudo}
        </Text>
        
        <View style={styles.backButton} />
      </View>

      {/* Bottom Controls - Only show when camera is ready */}
      {isCameraReady && (
        <View style={styles.bottomControls}>
        {/* Media Mode Toggle */}
        <TouchableOpacity
          style={[styles.mediaToggle, recordingMode === 'video' && styles.mediaToggleVideo]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
            cycleMediaMode()
          }}
        >
          <View style={[styles.mediaToggleIcon, 
            mediaMode === 'nsfw' && styles.mediaToggleIconNsfw,
            mediaMode === 'one_time' && styles.mediaToggleIconOneTime
          ]}>
            <Ionicons 
              name={getMediaModeInfo().icon} 
              size={20} 
              color={Colors.white} 
            />
          </View>
        </TouchableOpacity>

        {/* Recording Timer - positioned above everything when recording */}
        {isRecording && (
          <View style={styles.recordingTimer}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingText}>
              {recordingTime.toFixed(1)}s
            </Text>
          </View>
        )}
        
        {/* Progress Ring for Video Recording */}
        {isRecording && (
          <Animated.View 
            style={[
              styles.progressRing,
              styles.progressRingCentered,
              {
                transform: [{
                  scale: recordingProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 1.2]
                  })
                }]
              }
          ]}
          >
              <Animated.View 
                style={[
                  styles.progressCircle,
                  {
                    borderTopColor: Colors.fire,
                    borderRightColor: recordingProgress.interpolate({
                      inputRange: [0, 0.25, 0.5, 0.75, 1],
                      outputRange: ['transparent', 'transparent', Colors.fire, Colors.fire, Colors.fire]
                    }),
                    borderBottomColor: recordingProgress.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: ['transparent', 'transparent', Colors.fire]
                    }),
                    borderLeftColor: recordingProgress.interpolate({
                      inputRange: [0, 0.75, 1],
                      outputRange: ['transparent', 'transparent', Colors.fire]
                    }),
                    transform: [
                      {
                        rotate: recordingProgress.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', '360deg']
                        })
                      }
                    ]
                  }
                ]}
              />
            </Animated.View>
        )}

        {/* Camera Controls - clean left-center-right layout */}
        <View style={styles.controlsContainer}>
          {/* Left Side - Mode Controls and Timer/Mute */}
          <View style={styles.leftControlsRow}>
            <TouchableOpacity
              style={[styles.controlButton, recordingMode === 'video' && styles.controlButtonActive]}
              onPress={toggleRecordingMode}
            >
              <Ionicons 
                name={recordingMode === 'photo' ? 'videocam' : 'camera'} 
                size={20} 
                color={Colors.white} 
              />
            </TouchableOpacity>
            {recordingMode === 'photo' && (
              <TouchableOpacity
                style={[
                  styles.controlButton,
                  timerSeconds > 0 && styles.controlButtonActive,
                  isTimerActive && styles.controlButtonDisabled
                ]}
                onPress={cycleTimer}
                disabled={isTimerActive}
              >
                <Ionicons 
                  name="timer-outline" 
                  size={20} 
                  color={Colors.white} 
                />
                {timerSeconds > 0 && (
                  <Text style={styles.controlButtonBadge}>{timerSeconds}</Text>
                )}
              </TouchableOpacity>
            )}
            {recordingMode === 'video' && (
              <TouchableOpacity
                style={[styles.controlButton, isRecordingMuted && styles.controlButtonMuted]}
                onPress={toggleRecordingMute}
              >
                <Ionicons 
                  name={isRecordingMuted ? 'volume-mute' : 'volume-high'} 
                  size={20} 
                  color={Colors.white}
                />
              </TouchableOpacity>
            )}
          </View>

          {/* Center - Capture Button */}
          <View style={styles.centerSpace}>
            {/* Recording Status Hint */}
            {isLongPressing && !isRecording && (
              <View style={styles.recordingStatusHint}>
                <Text style={styles.recordingStatusText}>🎬 Recording...</Text>
              </View>
            )}
            {/* Active Recording Hint */}
            {recordingMode === 'video' && isRecordingActive && (
              <View style={styles.activeRecordingHint}>
                <Text style={styles.activeRecordingText}>🔴 REC - Tap to stop</Text>
              </View>
            )}
            <TouchableOpacity
              style={[
                styles.captureButton, 
                isRecording && styles.captureButtonRecording,
                isLongPressing && styles.captureButtonLongPress
              ]}
              onPress={handlePress}
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              activeOpacity={0.8}
            >
              <View style={[styles.captureInner, isRecording && styles.captureInnerRecording]} />
            </TouchableOpacity>
          </View>

          {/* Camera Switch Button - right side, alone */}
          <View style={styles.rightControlsAlone}>
            <TouchableOpacity
              style={styles.controlButton}
              onPress={async () => {
                // Cancel timer if active before switching cameras
                if (isTimerActive) {
                  cancelTimer()
                }
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                const newCameraType = type === 'back' ? 'front' : 'back'
                setType(newCameraType)
                // Save the camera preference
                try {
                  await saveCameraType(newCameraType)
                } catch (error) {
                  console.error('Failed to save camera type preference:', error)
                }
              }}
            >
              <Ionicons name="camera-reverse" size={20} color={Colors.white} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.black,
  },
  statusBarBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: getSafeAreaTop(),
    backgroundColor: Colors.black,
    zIndex: 1000,
  },
  gestureContainer: {
    flex: 1,
  },
  camera: {
    flex: 1,
    // Android-specific fixes for aspect ratio and display issues
    ...(Platform.OS === 'android' && {
      width: '100%',
      height: '100%',
      backgroundColor: '#000000', // Black background to prevent white flashes
      borderRadius: 0, // No rounded corners that could cause issues
    }),
    // iOS keeps simple flex: 1 (working well)
  },
  
  // Loading state
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    zIndex: 500,
  },
  loadingText: {
    color: Colors.white,
    fontSize: Typography.base,
    fontWeight: Typography.light,
  },
  
  // Zoom Components
  zoomIndicator: {
    position: 'absolute',
    top: '40%',
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    zIndex: 999,
  },
  zoomText: {
    color: Colors.white,
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
  },
  zoomResetButton: {
    position: 'absolute',
    top: getSafeAreaTop() + 60,
    right: Spacing.screen,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: BorderRadius.full,
    padding: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 999,
  },
  zoomResetText: {
    color: Colors.white,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    marginLeft: Spacing.xs,
  },
  
  // Top Overlay - Minimal, floating
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: getSafeAreaTop(),
    paddingHorizontal: Spacing.screen,
    paddingBottom: Spacing.lg,
    zIndex: 1000,
  },
  backButton: {
    width: Layout.touchTarget,
    height: Layout.touchTarget,
    justifyContent: 'center',
    alignItems: 'center',
  },
  username: {
    color: Colors.white,
    fontSize: Typography.lg,
    fontWeight: Typography.light,
    marginLeft: Spacing.md,
    flex: 1,
    textAlign: 'center',
  },
  
  // Bottom Controls
  bottomControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.screen,
    paddingBottom: 50,
    paddingTop: Spacing.xl,
  },
  
  // Media Toggle Button
  mediaToggle: {
    position: 'absolute',
    bottom: 195, // Fixed position for all modes
    left: Spacing.screen,
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Removed mediaToggleVideo to keep indicator always at same position
  mediaToggleIcon: {
    width: 50, // Match controlButton size
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255, 255, 255, 0.25)', // More visible
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    shadowColor: Colors.black, // Add shadow for consistency
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  mediaToggleIconNsfw: {
    backgroundColor: 'rgba(255, 107, 107, 0.4)',
    borderColor: 'rgba(255, 107, 107, 0.6)',
    shadowColor: Colors.accent,
  },
  mediaToggleIconOneTime: {
    backgroundColor: 'rgba(255, 193, 7, 0.4)',
    borderColor: 'rgba(255, 193, 7, 0.6)',
    shadowColor: '#FFC107',
  },
  
  // Recording Timer
  recordingTimer: {
    position: 'absolute',
    bottom: 180, // Better spacing from capture button
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.fire,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.lg,
    zIndex: 1000,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.white,
    marginRight: Spacing.xs,
  },
  recordingText: {
    color: Colors.white,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  
  // Progress Ring
  progressRing: {
    position: 'absolute',
    width: Layout.captureButtonOuter,
    height: Layout.captureButtonOuter,
    borderRadius: Layout.captureButtonOuter / 2,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 998, // Lower than capture button to allow touch events
  },
  progressRingCentered: {
    bottom: 80, // Match controlsContainer bottom position
    alignSelf: 'center',
  },
  progressCircle: {
    width: Layout.captureButtonOuter - 4,
    height: Layout.captureButtonOuter - 4,
    borderRadius: (Layout.captureButtonOuter - 4) / 2,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  // Camera Controls Layout - Clean and Consistent
  controlsContainer: {
    position: 'absolute',
    bottom: 80, // Lowered from 120 to prevent overlap
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  leftControlsRow: {
    width: 60,
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  centerSpace: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  // Capture Button
  captureButton: {
    width: Layout.captureButton,
    height: Layout.captureButton,
    borderRadius: Layout.captureButton / 2,
    backgroundColor: Colors.whiteOverlay,
    borderWidth: 3,
    borderColor: Colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000, // Higher than progress ring to ensure touch events work
  },
  captureButtonRecording: {
    backgroundColor: Colors.fire,
    borderColor: Colors.fire,
  },
  captureButtonLongPress: {
    backgroundColor: 'rgba(255, 107, 107, 0.3)',
    borderColor: Colors.fire,
    transform: [{ scale: 1.1 }],
  },
  captureInner: {
    width: Layout.captureButton - 20,
    height: Layout.captureButton - 20,
    borderRadius: (Layout.captureButton - 20) / 2,
    backgroundColor: Colors.white,
  },
  captureInnerRecording: {
    width: 30,
    height: 30,
    borderRadius: 4,
    backgroundColor: Colors.white,
  },
  rightControlsAlone: {
    width: 60,
    flexDirection: 'column',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
  },
  
  // Unified Control Button Style - Match Media Toggle
  controlButton: {
    width: 50, // Same size as mediaToggle
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255, 255, 255, 0.25)', // Same as mediaToggleIcon
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.4)', // Same as mediaToggleIcon
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  controlButtonActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.4)', // More visible when active
    borderColor: 'rgba(255, 255, 255, 0.8)',
    shadowOpacity: 0.4,
  },
  controlButtonMuted: {
    backgroundColor: 'rgba(60, 60, 60, 0.9)', // Dark gray instead of red
    borderColor: 'rgba(255, 255, 255, 0.6)', // White border for contrast
    shadowColor: Colors.black,
    shadowOpacity: 0.4,
  },
  controlButtonDisabled: {
    backgroundColor: 'rgba(100, 100, 100, 0.5)', // Grayed out when disabled
    borderColor: 'rgba(255, 255, 255, 0.3)',
    opacity: 0.6,
  },
  controlButtonBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: Colors.fire,
    color: Colors.white,
    fontSize: 10,
    fontWeight: Typography.bold,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 20,
    textAlign: 'center',
  },
  
  // Timer Countdown Overlay
  timerCountdownOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -75 }, { translateY: -75 }],
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  timerCountdownText: {
    fontSize: 48,
    fontWeight: Typography.bold,
    color: Colors.white,
    textAlign: 'center',
  },
  timerCancelButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Hint Text Styles - Consolidated and Clean
  modeHint: {
    position: 'absolute',
    bottom: 25, // Closer to capture button, below the controls
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    alignItems: 'center',
  },
  modeHintText: {
    color: Colors.white,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  recordingStatusHint: {
    position: 'absolute',
    bottom: 25, // Same position as modeHint for consistency
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 107, 107, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    alignItems: 'center',
  },
  recordingStatusText: {
    color: Colors.white,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  activeRecordingHint: {
    position: 'absolute',
    top: 120, // Keep this at the top for active recording
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 0, 0, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 25,
    alignItems: 'center',
  },
  activeRecordingText: {
    color: Colors.white,
    fontSize: Typography.md,
    fontWeight: Typography.bold,
  },
  previewMuteButton: {
    position: 'absolute',
    top: 100,
    right: Spacing.lg,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  
  // No Permission Screen
  background: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.black,
  },
  noPermissionText: {
    color: Colors.white,
    fontSize: Typography.xl,
    fontWeight: Typography.light,
    textAlign: 'center',
    marginBottom: Spacing.xl,
    paddingHorizontal: Spacing.screen,
  },
  requestButton: {
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
  },
  requestButtonText: {
    color: Colors.black,
    fontSize: Typography.base,
    fontWeight: Typography.medium,
  },
  
  // Preview Screen
  fullScreenMedia: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  mirroredMedia: {
    transform: [{ scaleX: -1 }],
  },
  previewContainer: {
    flex: 1,
    backgroundColor: Colors.black,
  },
  
  // Fixed Send Interface - No scrolling, proper keyboard handling
  sendInterface: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.blackOverlay,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
  },
  sendInterfaceAndroid: {
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.35)', // More opaque for better visibility
  },
  sendInterfaceContent: {
    paddingHorizontal: Spacing.screen,
    paddingTop: Spacing.xl,
    paddingBottom: Platform.OS === 'ios' ? 34 + Spacing.md : 30,
    minHeight: Platform.OS === 'android' ? 240 : 200, // Slightly taller for Android
  },
  
  // Send Media Toggle
  topRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
    alignItems: 'center',
  },
  sendMediaToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Platform.OS === 'android' ? 'rgba(255, 255, 255, 0.15)' : Colors.whiteOverlay,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 44,
    borderWidth: Platform.OS === 'android' ? 1 : 0,
    borderColor: Platform.OS === 'android' ? 'rgba(255, 255, 255, 0.25)' : 'transparent',
  },
  sendMediaToggleIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.sm,
  },
  sendMediaToggleIconNsfw: {
    backgroundColor: Colors.fire,
  },
  sendMediaToggleIconOneTime: {
    backgroundColor: '#FFC107',
  },
  sendMediaToggleText: {
    color: Colors.white,
    fontSize: Typography.base,
    fontWeight: Typography.medium,
  },
  
  // Caption Input
  captionInput: {
    backgroundColor: Colors.whiteOverlay,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    color: Colors.white,
    fontSize: Typography.base,
    fontWeight: Typography.light,
    marginBottom: Spacing.lg,
    minHeight: 44,
    maxHeight: 150,
    textAlignVertical: 'top',
  },
  captionInputAndroid: {
    padding: Spacing.lg,
    fontSize: Typography.base,
    minHeight: 56,
    maxHeight: 180,
    marginBottom: Spacing.lg,
    backgroundColor: 'rgba(255, 255, 255, 0.15)', // More visible background
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)', // Subtle border for definition
    color: Colors.white,
    fontWeight: Typography.light,
  },
  
  // Send Actions
  sendActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  cancelButton: {
    width: Layout.touchTarget,
    height: Layout.touchTarget,
    borderRadius: Layout.touchTarget / 2,
    backgroundColor: Platform.OS === 'android' ? 'rgba(255, 255, 255, 0.15)' : Colors.whiteOverlay,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: Platform.OS === 'android' ? 1 : 0,
    borderColor: Platform.OS === 'android' ? 'rgba(255, 255, 255, 0.25)' : 'transparent',
  },
  sendButton: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: BorderRadius.full,
    padding: Spacing.md,
    alignItems: 'center',
    marginLeft: Spacing.md,
    minHeight: 44,
    justifyContent: 'center',
    shadowColor: Platform.OS === 'android' ? Colors.black : 'transparent',
    shadowOffset: Platform.OS === 'android' ? { width: 0, height: 2 } : { width: 0, height: 0 },
    shadowOpacity: Platform.OS === 'android' ? 0.25 : 0,
    shadowRadius: Platform.OS === 'android' ? 4 : 0,
    elevation: Platform.OS === 'android' ? 4 : 0,
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
  sendButtonText: {
    color: Colors.black,
    fontSize: Typography.base,
    fontWeight: Typography.medium,
  },
  
  // Media Header for Preview
  mediaHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: getSafeAreaTop(),
    paddingHorizontal: Spacing.screen,
    paddingBottom: Spacing.lg,
    zIndex: 1000,
  },

  // Permission Screen Styles
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
    backgroundColor: Colors.black,
  },
  permissionTitle: {
    fontSize: Typography.xl,
    fontWeight: Typography.medium,
    color: Colors.white,
    textAlign: 'center',
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
  },
  permissionText: {
    fontSize: Typography.base,
    color: Colors.gray300,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  permissionButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.md,
  },
  permissionButtonText: {
    color: Colors.white,
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    textAlign: 'center',
  },
  backButtonAlt: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  backButtonAltText: {
    color: Colors.gray400,
    fontSize: Typography.base,
    textAlign: 'center',
  },
  
  // Error Container Styles
  errorContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.black,
    padding: Spacing.xl,
    zIndex: 1000,
  },
  errorTitle: {
    fontSize: Typography.xl,
    fontWeight: Typography.medium,
    color: Colors.white,
    textAlign: 'center',
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
  },
  errorText: {
    fontSize: Typography.base,
    color: Colors.gray300,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.xl,
    paddingHorizontal: Spacing.md,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.md,
  },
  retryButtonText: {
    color: Colors.white,
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    marginLeft: Spacing.sm,
  },
  backButtonError: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  backButtonErrorText: {
    color: Colors.gray400,
    fontSize: Typography.base,
    textAlign: 'center',
  },
})

export default CameraScreen
