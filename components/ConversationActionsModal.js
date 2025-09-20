import React from 'react'
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Animated,
  Dimensions,
  StyleSheet
} from 'react-native'
import { Colors } from '../constants/Colors'

const { height: screenHeight } = Dimensions.get('window')

export default function ConversationActionsModal({ 
  visible, 
  onClose, 
  user, 
  onReportUser,
  onBlockUser 
}) {
  const fadeAnim = React.useRef(new Animated.Value(0)).current
  const slideAnim = React.useRef(new Animated.Value(screenHeight)).current

  React.useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start()
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: screenHeight,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start()
    }
  }, [visible])

  const handleAction = (action) => {
    // Close modal first
    onClose()
    
    // Execute action after a small delay to allow modal to close
    setTimeout(() => {
      action()
    }, 200)
  }

  if (!visible) return null

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Animated.View 
          style={[styles.backdrop, { opacity: fadeAnim }]}
        >
          <TouchableOpacity 
            style={styles.backdropTouch}
            onPress={onClose}
            activeOpacity={1}
          />
        </Animated.View>
        
        <Animated.View 
          style={[
            styles.actionSheet,
            {
              transform: [{ translateY: slideAnim }]
            }
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.handle} />
            <Text style={styles.title}>
              Actions pour {user?.pseudo || 'cet utilisateur'}
            </Text>
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity 
              style={[styles.actionButton, styles.reportButton]}
              onPress={() => handleAction(onReportUser)}
            >
              <Text style={styles.actionIcon}>⚠️</Text>
              <View style={styles.actionContent}>
                <Text style={styles.actionTitle}>Signaler cet utilisateur</Text>
                <Text style={styles.actionSubtitle}>
                  Signaler un comportement inapproprié
                </Text>
              </View>
              <Text style={styles.actionArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.actionButton, styles.blockButton]}
              onPress={() => handleAction(onBlockUser)}
            >
              <Text style={styles.actionIcon}>🚫</Text>
              <View style={styles.actionContent}>
                <Text style={[styles.actionTitle, styles.blockActionTitle]}>Bloquer cet utilisateur</Text>
                <Text style={styles.actionSubtitle}>
                  Empêcher toute communication
                </Text>
              </View>
              <Text style={styles.actionArrow}>›</Text>
            </TouchableOpacity>
          </View>

          {/* Cancel Button */}
          <TouchableOpacity 
            style={styles.cancelButton}
            onPress={onClose}
          >
            <Text style={styles.cancelButtonText}>Annuler</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = {
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  backdropTouch: {
    flex: 1,
  },
  actionSheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40, // Safe area padding
  },
  header: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.grayLight,
    borderRadius: 2,
    marginBottom: 15,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    textAlign: 'center',
  },
  actions: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 15,
    borderRadius: 12,
    marginVertical: 5,
    backgroundColor: Colors.background,
  },
  reportButton: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.warning,
  },
  blockButton: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.error,
  },
  actionIcon: {
    fontSize: 24,
    marginRight: 15,
  },
  actionContent: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 2,
  },
  blockActionTitle: {
    color: Colors.error,
  },
  actionSubtitle: {
    fontSize: 14,
    color: Colors.grayDark,
  },
  actionArrow: {
    fontSize: 20,
    color: Colors.grayMedium,
    fontWeight: '300',
  },
  cancelButton: {
    marginTop: 10,
    marginHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: Colors.grayLight,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
}
