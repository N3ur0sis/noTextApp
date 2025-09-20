// Supabase Edge Function for sending push notifications
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PushNotificationRequest {
  userId: string
  title: string
  body: string
  data?: Record<string, any>
  priority?: 'low' | 'normal' | 'high'
  sound?: string | boolean
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { userId, title, body, data = {}, priority = 'normal', sound = 'default' }: PushNotificationRequest = await req.json()

    if (!userId || !title || !body) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: userId, title, body' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    console.log(`📱 [PUSH_FUNCTION] Sending notification to user: ${userId}`)

    // Get user's push token and notification preferences
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('push_token, notifications_enabled, pseudo')
      .eq('id', userId)
      .single()

    if (userError || !user) {
      console.error('User not found:', userError)
      return new Response(
        JSON.stringify({ error: 'User not found' }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    if (!user.push_token) {
      console.log('User has no push token registered')
      return new Response(
        JSON.stringify({ error: 'User has no push token' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    if (!user.notifications_enabled) {
      console.log('User has notifications disabled')
      return new Response(
        JSON.stringify({ message: 'User has notifications disabled' }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Prepare notification payload for Expo Push API
    const message = {
      to: user.push_token,
      title,
      body,
      data: {
        ...data,
        userId,
        timestamp: new Date().toISOString()
      },
      priority: priority === 'high' ? 'high' : 'normal',
      sound: sound === true || sound === 'default' ? 'default' : sound,
      badge: 1, // You might want to calculate this based on unread count
      channelId: data.type === 'message' ? 'messages' : 'system' // Use existing Android channels
    }

    // Send notification to Expo Push API
    const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    })

    const pushResult = await pushResponse.json()

    if (!pushResponse.ok) {
      console.error('Expo Push API error:', pushResult)
      return new Response(
        JSON.stringify({ error: 'Failed to send notification', details: pushResult }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    console.log('✅ [PUSH_FUNCTION] Notification sent successfully:', pushResult)

    // Log notification in database for analytics/debugging
    try {
      await supabase
        .from('notification_logs')
        .insert({
          user_id: userId,
          title,
          body,
          data,
          push_token: user.push_token,
          expo_response: pushResult,
          sent_at: new Date().toISOString()
        })
    } catch (logError) {
      console.error('Failed to log notification:', logError)
      // Don't fail the request if logging fails
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        result: pushResult,
        message: 'Notification sent successfully'
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Push notification function error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
