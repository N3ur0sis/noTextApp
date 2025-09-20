import { supabase } from './supabaseClient'

/**
 * Professional Report API Service
 * Handles both user and content reports through Supabase Edge Functions
 * Provides a robust backend solution for Apple App Store compliance
 */
export class ReportAPIService {
  
  /**
   * Submit a report (user or content) to the backend API
   * @param {Object} reportData - The report data
   * @param {string} reportData.type - 'user' or 'content'
   * @param {Object} reportData.reporter - Reporter information
   * @param {Object} reportData.reportedUser - Reported user information (optional for content reports)
   * @param {Object} reportData.message - Message information (for content reports)
   * @param {Object} reportData.reportedContent - Content information (alternative to message)
   * @param {string} reportData.category - Report category
   * @param {string} reportData.description - Detailed description
   * @param {string} reportData.timestamp - ISO timestamp
   * @returns {Promise<Object>} API response with report ID
   */
  static async submitReport(reportData) {
    try {
      console.log('📧 [REPORT_API] Submitting report via Edge Function:', {
        type: reportData.type,
        category: reportData.category,
        reporterId: reportData.reporter?.id,
        reportedUserId: reportData.reportedUser?.id,
        hasContent: !!(reportData.message || reportData.reportedContent)
      })

      // Get current session to ensure user is authenticated
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      
      if (sessionError) {
        throw new Error(`Authentication error: ${sessionError.message}`)
      }

      if (!session) {
        throw new Error('User must be authenticated to submit reports')
      }

      // Call the Edge Function
      const { data, error } = await supabase.functions.invoke('report', {
        body: {
          type: reportData.type || 'user',
          message: reportData.message,
          reportedUser: reportData.reportedUser,
          reportedContent: reportData.reportedContent,
          reporter: {
            id: reportData.reporter.id,
            pseudo: reportData.reporter.pseudo
          },
          category: reportData.category,
          description: reportData.description,
          timestamp: reportData.timestamp || new Date().toISOString()
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        }
      })

      if (error) {
        console.error('❌ [REPORT_API] Edge Function error:', error)
        throw new Error(`Report submission failed: ${error.message}`)
      }

      if (!data.success) {
        throw new Error(data.error || 'Unknown error occurred')
      }

      console.log('✅ [REPORT_API] Report submitted successfully:', {
        reportId: data.reportId,
        message: data.message
      })

      return {
        success: true,
        reportId: data.reportId,
        message: data.message || 'Report submitted successfully'
      }

    } catch (error) {
      console.error('❌ [REPORT_API] Failed to submit report:', error)
      
      // Provide user-friendly error messages
      let userMessage = 'Impossible d\'envoyer le signalement. Veuillez réessayer plus tard.'
      
      if (error.message.includes('Authentication')) {
        userMessage = 'Vous devez être connecté pour signaler du contenu.'
      } else if (error.message.includes('Network')) {
        userMessage = 'Problème de connexion. Vérifiez votre connexion internet.'
      } else if (error.message.includes('Missing required fields')) {
        userMessage = 'Informations manquantes. Veuillez remplir tous les champs requis.'
      }

      throw new Error(userMessage)
    }
  }

  /**
   * Submit a user report (wrapper for backward compatibility)
   */
  static async submitUserReport(reportData) {
    return this.submitReport({
      ...reportData,
      type: 'user'
    })
  }

  /**
   * Submit a content report (wrapper for specific content reporting)
   */
  static async submitContentReport(reportData) {
    return this.submitReport({
      ...reportData,
      type: 'content'
    })
  }

  /**
   * Get user's own reports (for transparency)
   * @returns {Promise<Array>} List of user's reports
   */
  static async getUserReports() {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      
      if (sessionError || !session) {
        throw new Error('User must be authenticated')
      }

      const { data, error } = await supabase
        .from('reports')
        .select(`
          id,
          report_type,
          category,
          description,
          status,
          resolved,
          created_at,
          updated_at,
          reported_user_pseudo,
          content_type
        `)
        .eq('reporter_id', session.user.id)
        .order('created_at', { ascending: false })

      if (error) {
        throw new Error(`Failed to fetch reports: ${error.message}`)
      }

      return data || []

    } catch (error) {
      console.error('❌ [REPORT_API] Failed to fetch user reports:', error)
      throw error
    }
  }

  /**
   * Check if user can submit reports (rate limiting, account status, etc.)
   * @returns {Promise<Object>} Validation result
   */
  static async validateReportEligibility() {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      
      if (sessionError || !session) {
        return {
          canReport: false,
          reason: 'User must be authenticated to submit reports'
        }
      }

      // Check recent reports to prevent spam
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      
      const { data: recentReports, error } = await supabase
        .from('reports')
        .select('id')
        .eq('reporter_id', session.user.id)
        .gte('created_at', twentyFourHoursAgo)

      if (error) {
        console.error('Failed to check report eligibility:', error)
        // Don't block user if we can't check, assume they can report
        return { canReport: true }
      }

      const reportCount = recentReports?.length || 0
      const maxReportsPerDay = 10 // Configurable limit

      if (reportCount >= maxReportsPerDay) {
        return {
          canReport: false,
          reason: `Vous avez atteint la limite de ${maxReportsPerDay} signalements par jour. Réessayez demain.`
        }
      }

      return {
        canReport: true,
        reportsToday: reportCount,
        remainingReports: maxReportsPerDay - reportCount
      }

    } catch (error) {
      console.error('❌ [REPORT_API] Error checking report eligibility:', error)
      // In case of error, allow reporting (fail open)
      return { canReport: true }
    }
  }
}

export default ReportAPIService
