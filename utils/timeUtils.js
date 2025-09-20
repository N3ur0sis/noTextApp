/**
 * Time formatting utilities with proper timezone handling
 * Provides consistent time formatting across the app
 */

/**
 * Format time in relative format (1m, 2h, 3j) like HomeScreen
 * @param {string|Date} dateString - The date to format
 * @returns {string} Formatted relative time
 */
export const formatRelativeTime = (dateString) => {
  if (!dateString) return ''
  
  try {
    // CRITICAL FIX: Treat timestamp as UTC by appending 'Z' if no timezone specified
    let utcDateString = dateString;
    if (dateString && typeof dateString === 'string' && 
        !dateString.includes('Z') && !dateString.includes('+') && !dateString.includes('-', 10)) {
      utcDateString = dateString + 'Z';
    }
    
    const date = new Date(utcDateString)
    const now = new Date()
    
    // Handle invalid dates
    if (isNaN(date.getTime())) {
      console.warn('Invalid date provided to formatRelativeTime:', dateString)
      return ''
    }
    
    const diffInMinutes = Math.floor((now - date) / (1000 * 60))
    
    if (diffInMinutes < 1) return 'À l\'instant'
    if (diffInMinutes < 60) return `${diffInMinutes}m`
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h`
    return `${Math.floor(diffInMinutes / 1440)}j`
  } catch (error) {
    console.error('Error formatting relative time:', error)
    return ''
  }
}

/**
 * Format time as absolute time with proper timezone handling
 * @param {string|Date} dateString - The date to format
 * @param {Object} options - Formatting options
 * @returns {string} Formatted absolute time
 */
export const formatAbsoluteTime = (dateString, options = {}) => {
  if (!dateString) return ''
  
  try {
    const date = new Date(dateString)
    
    // Handle invalid dates
    if (isNaN(date.getTime())) {
      console.warn('Invalid date provided to formatAbsoluteTime:', dateString)
      return ''
    }
    
    const defaultOptions = {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false, // Use 24-hour format
      timeZone: 'Europe/Paris' // Explicit timezone for France
    }
    
    const formatOptions = { ...defaultOptions, ...options }
    
    return date.toLocaleTimeString('fr-FR', formatOptions)
  } catch (error) {
    console.error('Error formatting absolute time:', error)
    return ''
  }
}

/**
 * Format message timestamp for chat display
 * Uses relative time for recent messages, absolute time for older ones
 * @param {string|Date} dateString - The date to format
 * @param {boolean} forceAbsolute - Force absolute time format
 * @returns {string} Formatted time for message display
 */
export const formatMessageTime = (dateString, forceAbsolute = false) => {
  if (!dateString) return ''
  
  try {
    const date = new Date(dateString)
    const now = new Date()
    
    // Handle invalid dates
    if (isNaN(date.getTime())) {
      console.warn('Invalid date provided to formatMessageTime:', dateString)
      return ''
    }
    
    const diffInHours = Math.floor((now - date) / (1000 * 60 * 60))
    
    // Use relative time for messages less than 24 hours old, unless forced to absolute
    if (!forceAbsolute && diffInHours < 24) {
      return formatRelativeTime(dateString)
    }
    
    // Use absolute time for older messages or when forced
    return formatAbsoluteTime(dateString)
  } catch (error) {
    console.error('Error formatting message time:', error)
    return ''
  }
}

/**
 * Get the device's timezone
 * @returns {string} Device timezone identifier
 */
export const getDeviceTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch (error) {
    console.error('Error getting device timezone:', error)
    return 'Europe/Paris' // Fallback
  }
}

/**
 * Check if two dates are on the same day
 * @param {string|Date} date1 
 * @param {string|Date} date2 
 * @returns {boolean}
 */
export const isSameDay = (date1, date2) => {
  if (!date1 || !date2) return false
  
  try {
    const d1 = new Date(date1)
    const d2 = new Date(date2)
    
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate()
  } catch (error) {
    console.error('Error comparing dates:', error)
    return false
  }
}
