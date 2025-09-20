import React, { useEffect, useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Dimensions
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Typography } from '../constants/Design'

const { width: screenWidth } = Dimensions.get('window')

export default function ConversationContextMenu({
  visible,
  position,
  user,
  onClose,
  onReport,
  onBlock,
  onDelete
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current
  const scaleAnim = useRef(new Animated.Value(0.8)).current

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 200,
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
        Animated.timing(scaleAnim, {
          toValue: 0.8,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start()
    }
  }, [visible])

  if (!visible || !position) return null

  const handleReport = () => {
    onClose()
    onReport()
  }

  const handleBlock = () => {
    onClose()
    onBlock()
  }

  const handleDelete = () => {
    onClose()
    onDelete()
  }

  // Calculate menu position - always below the conversation item
  const menuWidth = 200
  const menuHeight = 180 // Increased height for 3 options
  
  // Center horizontally, but keep within screen bounds
  let leftPosition = position.x - menuWidth / 2
  if (leftPosition < 20) leftPosition = 20
  if (leftPosition + menuWidth > screenWidth - 20) leftPosition = screenWidth - menuWidth - 20

  // Always position below the conversation item
  const topPosition = position.y
  const showArrowTop = true // Always show arrow pointing up to the conversation

  return (
    <>
      {/* Backdrop */}
      <TouchableOpacity 
        style={styles.backdrop} 
        onPress={onClose}
        activeOpacity={1}
      />
      
      {/* Context Menu */}
      <Animated.View
        style={[
          styles.menu,
          {
            left: leftPosition,
            top: topPosition,
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }]
          }
        ]}
      >
        {/* Arrow pointing up to conversation */}
        <View style={[styles.arrow, { 
          left: position.x - leftPosition - 8,
          top: -10,
          transform: [{ rotate: '225deg' }]
        }]} />
        
        {/* Menu Content */}
        <View style={styles.menuContent}>
          <Text style={styles.menuTitle}>
            {user?.pseudo || 'Utilisateur'}
          </Text>
          
          <TouchableOpacity style={styles.menuItem} onPress={handleReport}>
            <Ionicons name="flag-outline" size={18} color={Colors.fire} />
            <Text style={[styles.menuItemText, { color: Colors.fire }]}>
              Signaler
            </Text>
          </TouchableOpacity>
          
          <View style={styles.divider} />
          
          <TouchableOpacity style={styles.menuItem} onPress={handleBlock}>
            <Ionicons name="ban-outline" size={18} color={Colors.gray400} />
            <Text style={styles.menuItemText}>
              Bloquer
            </Text>
          </TouchableOpacity>
          
          <View style={styles.divider} />
          
          <TouchableOpacity style={styles.menuItem} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={18} color={Colors.fire} />
            <Text style={[styles.menuItemText, { color: Colors.fire }]}>
              Supprimer
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    zIndex: 998,
  },
  menu: {
    position: 'absolute',
    width: 200,
    zIndex: 999,
  },
  arrow: {
    position: 'absolute',
    width: 16,
    height: 16,
    backgroundColor: Colors.gray800,
    transform: [{ rotate: '45deg' }],
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: Colors.gray700,
  },
  menuContent: {
    backgroundColor: Colors.gray800,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.gray700,
    paddingVertical: Spacing.xs,
    shadowColor: Colors.black,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  menuTitle: {
    fontSize: Typography.base,
    fontWeight: '600',
    color: Colors.white,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    textAlign: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray700,
    marginBottom: Spacing.xs,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 44,
  },
  menuItemText: {
    fontSize: Typography.base,
    color: Colors.white,
    marginLeft: Spacing.sm,
    flex: 1,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.gray700,
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.xs,
  },
})
