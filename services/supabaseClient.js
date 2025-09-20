import { createClient } from '@supabase/supabase-js'
import Constants from 'expo-constants'

const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl
const supabaseAnonKey = Constants.expoConfig?.extra?.supabaseAnonKey

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

// Helper function to get the device-bound auth headers  
export const getAuthHeaders = async () => {
  const { data: { session } } = await supabase.auth.getSession()
  return session
    ? { Authorization: `Bearer ${session.access_token}`, apikey: supabaseAnonKey }
    : { apikey: supabaseAnonKey }
}
