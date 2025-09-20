import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase client with service role for database operations
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { 
          status: 405, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const { 
      type,
      message,
      reportedUser,
      reportedContent,
      reporter,
      category,
      description,
      timestamp 
    } = await req.json()

    // Validate required fields
    if (!reporter?.id || !category || !description) {
      return new Response(
        JSON.stringify({ 
          error: 'Missing required fields: reporter.id, category, description' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Insert report into database
    const reportData = {
      reporter_id: reporter.id,
      reporter_pseudo: reporter.pseudo,
      reported_user_id: reportedUser?.id,
      reported_user_pseudo: reportedUser?.pseudo,
      report_type: type || 'user',
      category: category,
      description: description.trim(),
      // Content-specific fields
      message_id: message?.id || reportedContent?.messageId,
      content_sender_id: message?.sender_id || reportedContent?.senderId,
      content_type: message?.content_type || reportedContent?.contentType,
      content_created_at: message?.created_at || reportedContent?.createdAt,
      // Metadata
      created_at: timestamp || new Date().toISOString(),
      status: 'pending',
      resolved: false
    }

    const { data: savedReport, error: dbError } = await supabaseClient
      .from('reports')
      .insert([reportData])
      .select()
      .single()

    if (dbError) {
      console.error('Database error:', dbError)
      return new Response(
        JSON.stringify({ 
          error: 'Failed to save report', 
          details: dbError.message 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Send email notification to moderation team
    try {
      await sendModerationEmail(savedReport)
    } catch (emailError) {
      console.error('Email error:', emailError)
      // Don't fail the request if email fails, report is still saved
    }

    console.log('✅ Report saved successfully:', savedReport.id)
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        reportId: savedReport.id,
        message: 'Report submitted successfully'
      }),
      {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )

  } catch (error) {
    console.error('Unexpected error:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})

// Function to send email to moderation team
async function sendModerationEmail(report) {
  const categoryLabels = {
    harassment: 'Harcèlement',
    inappropriate_content: 'Contenu inapproprié',
    spam: 'Spam',
    illegal_content: 'Contenu illégal',
    minor_safety: 'Sécurité des mineurs',
    non_consensual: 'Contenu non consensuel',
    fake_profile: 'Faux profil',
    threats: 'Menaces',
    other: 'Autre'
  }

  const isContentReport = report.report_type === 'content'
  const categoryLabel = categoryLabels[report.category] || report.category

  const subject = isContentReport 
    ? `[NoText App] Signalement contenu - ${categoryLabel}`
    : `[NoText App] Signalement utilisateur - ${categoryLabel}`

  const emailBody = isContentReport 
    ? formatContentReportEmail(report, categoryLabel)
    : formatUserReportEmail(report, categoryLabel)

  // Here you can integrate with your email service
  // Example with SendGrid, Mailgun, or SMTP
  
  // For now, we'll use a webhook or external email service
  // You can replace this with your preferred email provider
  
  const emailPayload = {
    to: 'contact@solodesign.fr',
    subject: subject,
    html: emailBody,
    from: 'noreply@notext.app',
    reportId: report.id
  }

  // Example: Send via webhook to your email service
  // await fetch('YOUR_EMAIL_WEBHOOK_URL', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify(emailPayload)
  // })

  console.log('📧 Email notification prepared for report:', report.id)
  console.log('Email subject:', subject)
}

function formatContentReportEmail(report, categoryLabel) {
  const createdAt = new Date(report.created_at).toLocaleString('fr-FR')
  const contentCreatedAt = report.content_created_at 
    ? new Date(report.content_created_at).toLocaleString('fr-FR')
    : 'Non spécifié'

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Signalement de contenu - NoText App</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #d32f2f; border-bottom: 2px solid #d32f2f; padding-bottom: 10px;">
          🚨 SIGNALEMENT DE CONTENU - NoText App
        </h1>
        
        <div style="background-color: #fff3e0; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h2 style="color: #f57c00; margin-top: 0;">Informations du signalement</h2>
          <ul>
            <li><strong>ID du signalement :</strong> ${report.id}</li>
            <li><strong>Date et heure :</strong> ${createdAt}</li>
            <li><strong>Catégorie :</strong> ${categoryLabel}</li>
            <li><strong>Type :</strong> Signalement de contenu</li>
          </ul>
        </div>

        <div style="background-color: #f3e5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h2 style="color: #7b1fa2; margin-top: 0;">Contenu signalé</h2>
          <ul>
            <li><strong>ID du message :</strong> ${report.message_id || 'Non spécifié'}</li>
            <li><strong>Type de contenu :</strong> ${report.content_type || 'Non spécifié'}</li>
            <li><strong>Envoyé par :</strong> ${report.reported_user_pseudo || 'Inconnu'} (ID: ${report.reported_user_id || 'N/A'})</li>
            <li><strong>Date de création du contenu :</strong> ${contentCreatedAt}</li>
          </ul>
        </div>

        <div style="background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h2 style="color: #2e7d32; margin-top: 0;">Rapporteur</h2>
          <ul>
            <li><strong>Pseudo :</strong> ${report.reporter_pseudo || 'Anonyme'}</li>
            <li><strong>ID :</strong> ${report.reporter_id}</li>
          </ul>
        </div>

        <div style="background-color: #fff; border: 1px solid #ddd; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h2 style="margin-top: 0;">Description du problème</h2>
          <p style="white-space: pre-wrap;">${report.description}</p>
        </div>

        <div style="background-color: #e1f5fe; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h2 style="color: #0277bd; margin-top: 0;">Actions recommandées</h2>
          <ol>
            <li>Examiner le contenu signalé dans l'application</li>
            <li>Vérifier l'historique de l'utilisateur qui a envoyé le contenu</li>
            <li>Évaluer la gravité selon nos politiques de modération</li>
            <li>Prendre les mesures appropriées (avertissement, suspension, suppression)</li>
            <li>Notifier le rapporteur du résultat</li>
          </ol>
        </div>

        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; font-size: 12px; color: #666;">
          <p><strong>Détails techniques :</strong></p>
          <ul>
            <li>Application : NoText</li>
            <li>Type de signalement : ${report.report_type}</li>
            <li>Timestamp : ${report.created_at}</li>
            <li>Statut : ${report.status}</li>
          </ul>
          <p style="margin-bottom: 0;"><em>Ce signalement a été généré automatiquement par l'application NoText.</em></p>
        </div>
      </div>
    </body>
    </html>
  `
}

function formatUserReportEmail(report, categoryLabel) {
  const createdAt = new Date(report.created_at).toLocaleString('fr-FR')

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Signalement utilisateur - NoText App</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #d32f2f; border-bottom: 2px solid #d32f2f; padding-bottom: 10px;">
          🚨 SIGNALEMENT UTILISATEUR - NoText App
        </h1>
        
        <div style="background-color: #fff3e0; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h2 style="color: #f57c00; margin-top: 0;">Informations du signalement</h2>
          <ul>
            <li><strong>ID du signalement :</strong> ${report.id}</li>
            <li><strong>Date et heure :</strong> ${createdAt}</li>
            <li><strong>Catégorie :</strong> ${categoryLabel}</li>
            <li><strong>Type :</strong> Signalement d'utilisateur</li>
          </ul>
        </div>

        <div style="background-color: #ffebee; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h2 style="color: #c62828; margin-top: 0;">Utilisateur signalé</h2>
          <ul>
            <li><strong>Pseudo :</strong> ${report.reported_user_pseudo || 'Non spécifié'}</li>
            <li><strong>ID :</strong> ${report.reported_user_id || 'Non spécifié'}</li>
          </ul>
        </div>

        <div style="background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h2 style="color: #2e7d32; margin-top: 0;">Rapporteur</h2>
          <ul>
            <li><strong>Pseudo :</strong> ${report.reporter_pseudo || 'Anonyme'}</li>
            <li><strong>ID :</strong> ${report.reporter_id}</li>
          </ul>
        </div>

        <div style="background-color: #fff; border: 1px solid #ddd; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h2 style="margin-top: 0;">Description du problème</h2>
          <p style="white-space: pre-wrap;">${report.description}</p>
        </div>

        <div style="background-color: #e1f5fe; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h2 style="color: #0277bd; margin-top: 0;">Actions recommandées</h2>
          <ol>
            <li>Vérifier le profil et l'historique de l'utilisateur signalé</li>
            <li>Examiner les conversations récentes si applicable</li>
            <li>Évaluer la gravité selon nos politiques de modération</li>
            <li>Prendre les mesures appropriées (avertissement, suspension, ban)</li>
            <li>Contacter le rapporteur si des clarifications sont nécessaires</li>
          </ol>
        </div>

        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; font-size: 12px; color: #666;">
          <p><strong>Détails techniques :</strong></p>
          <ul>
            <li>Application : NoText</li>
            <li>Type de signalement : ${report.report_type}</li>
            <li>Timestamp : ${report.created_at}</li>
            <li>Statut : ${report.status}</li>
          </ul>
          <p style="margin-bottom: 0;"><em>Ce signalement a été généré automatiquement par l'application NoText.</em></p>
        </div>
      </div>
    </body>
    </html>
  `
}
