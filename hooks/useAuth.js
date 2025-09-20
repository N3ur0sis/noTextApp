import { useEffect, useState } from 'react'
import { DeviceAuthService } from '../services/deviceAuthService'

export const useAuth = () => {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    initializeAuth()
  }, [])

  const initializeAuth = async () => {
    try {
      setLoading(true)
      const currentUser = await DeviceAuthService.initialize()
      setUser(currentUser)
      setError(null)
    } catch (err) {
      setError(err.message)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  const login = async (userData) => {
    setUser(userData)
    setError(null)
  }

  const logout = async () => {
    try {
      await DeviceAuthService.logout()
      setUser(null)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  const refreshAuth = async () => {
    try {
      const refreshedUser = await DeviceAuthService.refreshToken()
      setUser(refreshedUser)
      setError(null)
      return refreshedUser
    } catch (err) {
      setError(err.message)
      await logout() // If refresh fails, logout
      throw err
    }
  }

  return {
    user,
    loading,
    error,
    login,
    logout,
    refreshAuth,
    isAuthenticated: !!user
  }
}
