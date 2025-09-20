import ReportAPIService from './reportAPIService'

// Enhanced report service with API integration and email fallback
export class ReportEmailService {
  static async sendReport(reportData) {
    // Try API first for professional backend integration
    try {
      console.log('📡 [REPORT_SERVICE] Attempting API submission first...')
      const result = await ReportAPIService.submitReport(reportData)
      
      if (result.success) {
        console.log('✅ [REPORT_SERVICE] Report submitted via API successfully:', result.reportId)
        return { success: true, method: 'api', reportId: result.reportId }
      }
    } catch (apiError) {
      console.warn('⚠️ [REPORT_SERVICE] API submission failed, falling back to email:', apiError.message)
      
      // Don't throw error here, continue to email fallback
    }

    // Fallback to email method if API fails
    return await this.sendReportViaEmail(reportData)
  }

  static async sendReportViaEmail(reportData) {
    const { 
      reportedUser, 
      reporter,
      category, 
      description, 
      timestamp,
      type = 'user', // Default to user report for backward compatibility
      reportedContent
    } = reportData

    try {
      console.log('📧 [REPORT_EMAIL] Sending report email...', {
        type,
        reportedUser: reportedUser?.pseudo,
        reportedUserId: reportedUser?.id,
        reporterPseudo: reporter?.pseudo,
        reporterId: reporter?.id,
        category,
        timestamp,
        hasContent: !!reportedContent
      })

      // Format the email content based on report type
      const isContentReport = type === 'content'
      const emailSubject = isContentReport 
        ? `[NoText App] Signalement contenu - ${category}`
        : `[NoText App] Signalement utilisateur - ${category}`
      const emailBody = isContentReport 
        ? this.formatContentReportEmailBody(reportData)
        : this.formatEmailBody(reportData)

      // For now, we'll use a simple mailto approach
      // In production, you might want to use a proper email service like SendGrid, Mailgun, etc.
      
      const mailtoUrl = `mailto:contact@solodesign.fr?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`
      
      // Open the default email client
      const { Linking } = require('react-native')
      const canOpen = await Linking.canOpenURL(mailtoUrl)
      
      if (canOpen) {
        await Linking.openURL(mailtoUrl)
        console.log('✅ [REPORT_EMAIL] Email client opened successfully')
        console.log('📋 [REPORT_EMAIL] Email subject:', emailSubject)
        console.log('📋 [REPORT_EMAIL] Report includes:', {
          hasReportedUser: !!reportedUser,
          hasReporter: !!reporter,
          category,
          descriptionLength: description?.length || 0
        })
        return { success: true }
      } else {
        // On simulator or devices without email client, log for manual processing
        console.warn('📧 [REPORT_EMAIL] No email client available, logging report for manual processing')
        console.log('📋 [REPORT_EMAIL] Report data for manual processing:', {
          timestamp: new Date().toISOString(),
          category: reportData.category,
          description: reportData.description,
          reportedUser: reportData.reportedUser,
          reporter: reportData.reporter,
          type: reportData.type
        })
        
        // Return success for simulator/testing
        return { success: true, method: 'logged' }
      }

    } catch (error) {
      console.error('❌ [REPORT_EMAIL] Failed to send report email:', error)
      
      // Check if it's just a "Cannot open email client" error
      if (error.message.includes('Cannot open email client') || error.message.includes('email client')) {
        console.warn('📧 [REPORT_EMAIL] Email client not available, treating as successful for development')
        console.log('📋 [REPORT_EMAIL] Report logged for manual processing:', {
          timestamp: new Date().toISOString(),
          category: reportData.category,
          description: reportData.description,
          reportedUser: reportData.reportedUser,
          reporter: reportData.reporter,
          type: reportData.type
        })
        
        // Return success for development/simulator
        return { success: true, method: 'logged' }
      }
      
      throw error
    }
  }

  static formatEmailBody(reportData) {
    const { 
      reportedUser, 
      reporter,
      category, 
      description, 
      timestamp 
    } = reportData

    const categoryLabels = {
      harassment: 'Harcèlement',
      inappropriate_content: 'Contenu inapproprié',
      spam: 'Spam',
      fake_profile: 'Faux profil',
      minor: 'Mineur',
      threats: 'Menaces',
      other: 'Autre'
    }

    // Use reporter info
    const reporterInfo = reporter 
      ? `${reporter.pseudo} (ID: ${reporter.id})`
      : 'Utilisateur non identifié'

    const reportedUserSection = reportedUser 
      ? `UTILISATEUR SIGNALÉ
------------------
• ID: ${reportedUser.id}
• Pseudo: ${reportedUser.pseudo}
`
      : `UTILISATEUR SIGNALÉ
------------------
• Utilisateur non spécifié ou signalement général
`

    return `
SIGNALEMENT UTILISATEUR - NoText App
=====================================

INFORMATIONS DU SIGNALEMENT
---------------------------
• Date et heure: ${new Date(timestamp).toLocaleString('fr-FR')}
• Catégorie: ${categoryLabels[category] || category}
• Signalé par: ${reporterInfo}

${reportedUserSection}

DESCRIPTION DU PROBLÈME
----------------------
${description}

ACTIONS RECOMMANDÉES
-------------------
• Vérifier le profil et l'historique de l'utilisateur signalé
• Examiner les conversations récentes si applicable
• Prendre les mesures appropriées selon la politique de modération
• Contacter le rapporteur si des clarifications sont nécessaires

DÉTAILS TECHNIQUES
-----------------
• Application: NoText
• Type de signalement: ${category}
• Timestamp: ${timestamp}
${reporter ? `• ID du rapporteur: ${reporter.id}` : ''}

---
Ce signalement a été généré automatiquement par l'application NoText.
Pour toute question, contactez l'équipe de développement.
    `.trim()
  }

  // Format email body for content reports
  static formatContentReportEmailBody(reportData) {
    const { 
      reportedUser, 
      reporter,
      category, 
      description, 
      timestamp,
      message,
      reportedContent
    } = reportData

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

    const reporterInfo = reporter 
      ? `${reporter.pseudo} (ID: ${reporter.id})`
      : 'Utilisateur non identifié'

    const contentInfo = message || reportedContent
    const contentCreatedAt = contentInfo?.created_at || contentInfo?.createdAt
    const contentType = contentInfo?.content_type || contentInfo?.contentType || 'Non spécifié'
    const messageId = contentInfo?.id || contentInfo?.messageId || 'Non spécifié'
    const senderId = contentInfo?.sender_id || contentInfo?.senderId || reportedUser?.id || 'Non spécifié'

    return `
SIGNALEMENT DE CONTENU - NoText App
===================================

INFORMATIONS DU SIGNALEMENT
---------------------------
• Date et heure: ${new Date(timestamp).toLocaleString('fr-FR')}
• Catégorie: ${categoryLabels[category] || category}
• Signalé par: ${reporterInfo}

CONTENU SIGNALÉ
---------------
• ID du message: ${messageId}
• Type de contenu: ${contentType}
• Envoyé par: ${reportedUser?.pseudo || 'Utilisateur inconnu'} (ID: ${senderId})
• Date de création: ${contentCreatedAt ? new Date(contentCreatedAt).toLocaleString('fr-FR') : 'Non spécifiée'}

DESCRIPTION DU PROBLÈME
----------------------
${description}

ACTIONS RECOMMANDÉES
-------------------
• Examiner le contenu signalé dans l'application
• Vérifier l'historique de l'utilisateur qui a envoyé le contenu
• Évaluer la gravité selon la politique de modération
• Prendre les mesures appropriées (suppression, avertissement, suspension)
• Notifier le rapporteur du résultat

DÉTAILS TECHNIQUES
-----------------
• Application: NoText
• Type de signalement: Contenu
• Timestamp: ${timestamp}
${reporter ? `• ID du rapporteur: ${reporter.id}` : ''}

---
Ce signalement a été généré automatiquement par l'application NoText.
Pour toute question, contactez l'équipe de développement.
    `.trim()
  }

  // Alternative method using a web service (for future implementation)
  static async sendReportViaAPI(reportData) {
    try {
      // This would be implemented with your backend API
      const response = await fetch('https://your-api.com/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...reportData,
          app: 'NoText',
          version: '1.0.0'
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const result = await response.json()
      console.log('✅ [REPORT_API] Report sent successfully:', result)
      return result

    } catch (error) {
      console.error('❌ [REPORT_API] Failed to send report via API:', error)
      throw error
    }
  }
}

export default ReportEmailService
