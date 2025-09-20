import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RefreshRequest {
  refresh_token?: string
  device_id: string
  user_id?: string // Optional: for session restoration
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { refresh_token, device_id, user_id } = await req.json() as RefreshRequest

    // Validate input
    if (!device_id) {
      return new Response(
        JSON.stringify({ error: 'Missing device_id' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Create admin client with service role key
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    let sessionData: any
    let userProfile: any

    if (refresh_token) {
      // Standard refresh token flow
      const { data: refreshData, error: refreshError } = await admin.auth.refreshSession({
        refresh_token
      })

      if (refreshError || !refreshData.session || !refreshData.user) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired refresh token' }),
          { 
            status: 401, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
      }

      sessionData = refreshData
      
      // Verify the device_id matches the user's device
      const { data: profile, error: profileError } = await admin
        .from('users')
        .select('*')
        .eq('id', sessionData.user.id)
        .eq('device_id', device_id)
        .single()

      if (profileError || !profile) {
        return new Response(
          JSON.stringify({ error: 'Device mismatch or user not found' }),
          { 
            status: 403, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
      }

      userProfile = profile
      
    } else if (user_id) {
      // Session restoration flow - create new session for existing user
      console.log('Session restoration requested for user:', user_id)
      
      // First verify the user exists with the correct device_id
      const { data: profile, error: profileError } = await admin
        .from('users')
        .select('*')
        .eq('id', user_id)
        .eq('device_id', device_id)
        .single()

      if (profileError || !profile) {
        return new Response(
          JSON.stringify({ error: 'User not found or device mismatch' }),
          { 
            status: 403, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
      }

      userProfile = profile

      // Get user's stored password for sign-in (constructed from device_id)
      const devicePassword = device_id.slice(-16) + 'DeviceAuth!'
      
      // First try to get the user's actual email from the auth system
      const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(user_id)
      
      // Create a valid email format as fallback with the same logic as registration
      const sanitizedId = device_id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().substring(0, 20)
      const additionalRandomness = user_id.substring(0, 6) // Use part of user ID for consistency
      const fallbackEmail = `user_${sanitizedId}_${additionalRandomness}@example.com`
      
      // Determine which email to use
      let userEmail = fallbackEmail
      
      if (!authUserError && authUser?.user?.email) {
        // Use the actual email from the auth system if available
        console.log('Found user email from auth system:', authUser.user.email)
        userEmail = authUser.user.email
      } else {
        console.log('Using fallback email format:', fallbackEmail)
      }
      
      // Generate a new session by directly signing in
      const { data: signInData, error: signInError } = await admin.auth.signInWithPassword({
        email: userEmail,
        password: devicePassword
      })
      
      if (signInError || !signInData?.session) {
        console.error('Sign-in failed for email', userEmail, ':', signInError)
        
        // If the primary attempt failed and we used the actual email, try the fallback
        if (userEmail !== fallbackEmail) {
          console.log('Trying fallback email:', fallbackEmail)
          
          const { data: fallbackData, error: fallbackError } = await admin.auth.signInWithPassword({
            email: fallbackEmail,
            password: devicePassword
          })
          
          if (fallbackError || !fallbackData?.session) {
            console.error('Fallback sign-in also failed:', fallbackError)
            return new Response(
              JSON.stringify({ 
                error: 'Failed to restore session', 
                details: fallbackError?.message || signInError?.message 
              }),
              { 
                status: 500, 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              }
            )
          }
          
          // Use the fallback session data
          sessionData = fallbackData
        } else {
          // Original attempt with fallback email also failed
          return new Response(
            JSON.stringify({ error: 'Failed to restore session', details: signInError?.message }),
            { 
              status: 500, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
          )
        }
      } else {
        // Primary sign-in worked
        sessionData = signInData
      }
      
    } else {
      return new Response(
        JSON.stringify({ error: 'Either refresh_token or user_id must be provided' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }
    
    // We should never reach here, but TypeScript wants signInError and signInData to be defined
    // for the code below, so we'll just declare them as undefined
    let signInError = undefined
    let signInData = { session: undefined }

    // Return the refreshed session
    return new Response(
      JSON.stringify({
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
        token_type: 'bearer',
        expires_in: sessionData.session.expires_in,
        user: userProfile
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Token refresh error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
