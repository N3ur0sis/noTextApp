// supabase/functions/markRead/index.ts (Deno Edge Function, pair-based + secure)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const H = { 'content-type': 'application/json' }

export default async function handler(req: Request) {
  try {
    const { receiverId, senderId, beforeISO } = await req.json().catch(() => ({} as any))
    if (!receiverId || !senderId || !beforeISO) {
      return new Response(JSON.stringify({ error: 'Missing params' }), { status: 400, headers: H })
    }

    // 1) Auth: read the caller from the Bearer token
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabaseUser = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: userData, error: userErr } = await supabaseUser.auth.getUser()
    if (userErr || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: H })
    }
    const authUserId = userData.user.id
    if (authUserId !== receiverId) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: H })
    }

    // 2) Update DB in batch (pair-based) with service role
    const supabaseService = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Debug: log incoming params so function logs show attempts
    console.log('markRead called', { receiverId, senderId, beforeISO, authUserId })

    // Use your existing RPC to batch-update unseen rows by pair
    const { data: updated, error } = await supabaseService.rpc('fn_mark_messages_read_by_pair', {
      p_receiver_id: receiverId,
      p_sender_id: senderId,
      p_before: beforeISO,
    })

    if (error) {
      console.error('markRead rpc error', String(error.message ?? error))
      return new Response(JSON.stringify({ error: String(error.message ?? error) }), { status: 400, headers: H })
    }

    const updatedRows = (updated ?? [])
    const messageIds: string[] = updatedRows.map((r: any) => r.updated_id)
    const updatedCount = updatedRows.length
    const seenAt = new Date().toISOString()

    // Debug: report what we updated
    console.log('markRead result', { updatedCount, messageIds })

    // DO NOT broadcast — Postgres Changes / Realtime will emit UPDATE events
    return new Response(JSON.stringify({ ok: true, messageIds, updatedCount, seenAt }), { status: 200, headers: H })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: H })
  }
}