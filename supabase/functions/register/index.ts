import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RegisterRequest {
  pseudo: string
  age: number
  sexe: string
  device_id: string
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { pseudo, age, sexe, device_id } = await req.json() as RegisterRequest

    // Validate input
    if (!pseudo || !age || !device_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: pseudo, age, device_id' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    if (age < 18) {
      return new Response(
        JSON.stringify({ error: 'Age must be at least 18' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    if (pseudo.length < 3) {
      return new Response(
        JSON.stringify({ error: 'Pseudo must be at least 3 characters' }),
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

    // Step 1: Check if pseudo or device_id already exists
    const { data: existingByPseudo } = await admin
      .from('users')
      .select('id, pseudo')
      .eq('pseudo', pseudo)
      .maybeSingle()
      
    if (existingByPseudo) {
      return new Response(
        JSON.stringify({ error: 'Ce pseudo est déjà pris' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Check for existing device separately with better escaping
    const { data: existingByDevice } = await admin
      .from('users')
      .select('id, device_id')
      .eq('device_id', device_id)
      .maybeSingle()

    if (existingByDevice) {
      // Instead of error, we could offer to restore the session
      // but for now we'll just return an error
      return new Response(
        JSON.stringify({ error: 'This device is already registered' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Step 2: Create Auth user FIRST to get the UUID
    console.log('Creating Auth user first to get UUID:', { pseudo, age, sexe, device_id })
    
    // Create a valid unique email for auth user (use consistent format)
    const sanitizedId = device_id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().substring(0, 20); // Use more characters
    const additionalRandomness = Math.random().toString(36).substring(2, 8); // Add extra randomness
    const validEmail = `user_${sanitizedId}_${additionalRandomness}@example.com`;
    
    console.log('Using consistent email format:', validEmail);
    
    const devicePassword = device_id.slice(-16) + 'DeviceAuth!'
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: validEmail,
      password: devicePassword,
      email_confirm: true,
      user_metadata: {
        pseudo,
        age,
        sexe,
        device_id,
        auth_type: 'device_bound'
      }
    })

    if (authError || !authData.user) {
      console.error('Auth user creation error:', authError)
      return new Response(
        JSON.stringify({ error: 'Failed to create auth user', details: authError?.message }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    console.log('Auth user created successfully with ID:', authData.user.id)

    // Step 3: Create user profile using the Auth user's UUID
    const { data: userProfile, error: userError } = await admin
      .from('users')
      .insert({
        id: authData.user.id, // Use the Auth user's UUID as primary key
        pseudo,
        age,
        sexe: sexe || 'Autre',
        device_id
      })
      .select()
      .single()

    if (userError) {
      console.error('User profile creation error:', userError)
      // Clean up the Auth user if profile creation fails
      await admin.auth.admin.deleteUser(authData.user.id)
      return new Response(
        JSON.stringify({ error: userError.message }),
        { 
          status: userError.message.includes('déjà pris') || userError.message.includes('already registered') ? 400 : 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    console.log('User profile created successfully with matching ID:', userProfile.id)

    // Step 4: Update user with app_metadata to include dev_id in JWT claims
    const { error: updateError } = await admin.auth.admin.updateUserById(authData.user.id, {
      app_metadata: { dev_id: device_id }
    })
    
    if (updateError) {
      console.error('Failed to update user with dev_id:', updateError)
      return new Response(
        JSON.stringify({ error: 'Failed to update user with device ID', details: updateError.message }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Step 5: Sign in to create a session
    const { data: signInData, error: signInError } = await admin.auth.signInWithPassword({
      email: validEmail, // Use the same valid email we created above
      password: devicePassword
    })

    if (signInError || !signInData.session) {
      console.error('Sign-in failed:', signInError)
      return new Response(
        JSON.stringify({ error: 'Cannot create session', details: signInError?.message }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const { session } = signInData
    console.log('Session created successfully for user:', userProfile.id)

    // Return the session and user data
    return new Response(
      JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        token_type: 'bearer',
        expires_in: session.expires_in,
        user: userProfile, // Return the database user profile with matching ID
        auth_email: validEmail // Include the email used for auth
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Registration error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
