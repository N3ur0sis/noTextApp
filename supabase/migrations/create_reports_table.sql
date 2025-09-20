-- Create reports table for storing user and content reports
CREATE TABLE IF NOT EXISTS reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Reporter information
  reporter_id UUID NOT NULL,
  reporter_pseudo TEXT,
  
  -- Reported user information (for user reports)
  reported_user_id UUID,
  reported_user_pseudo TEXT,
  
  -- Report metadata
  report_type TEXT NOT NULL CHECK (report_type IN ('user', 'content')) DEFAULT 'user',
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  
  -- Content-specific fields (for content reports)
  message_id UUID,
  content_sender_id UUID,
  content_type TEXT,
  content_created_at TIMESTAMPTZ,
  
  -- Status tracking
  status TEXT NOT NULL CHECK (status IN ('pending', 'reviewing', 'resolved', 'dismissed')) DEFAULT 'pending',
  resolved BOOLEAN DEFAULT FALSE,
  resolution_notes TEXT,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_reported_user_id ON reports(reported_user_id);
CREATE INDEX IF NOT EXISTS idx_reports_message_id ON reports(message_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_type_category ON reports(report_type, category);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_reports_updated_at
  BEFORE UPDATE ON reports
  FOR EACH ROW
  EXECUTE FUNCTION update_reports_updated_at();

-- Add RLS (Row Level Security) policies
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own reports (as reporter)
CREATE POLICY "Users can view their own reports" ON reports
  FOR SELECT USING (reporter_id = auth.uid());

-- Policy: Users can create reports
CREATE POLICY "Users can create reports" ON reports
  FOR INSERT WITH CHECK (reporter_id = auth.uid());

-- Policy: Only admins/moderators can update reports (you'll need to create admin roles)
-- For now, we'll allow service role to update
CREATE POLICY "Service role can update reports" ON reports
  FOR UPDATE USING (true);

-- Add comments for documentation
COMMENT ON TABLE reports IS 'Table for storing user and content reports for moderation';
COMMENT ON COLUMN reports.report_type IS 'Type of report: user (user behavior) or content (specific message/media)';
COMMENT ON COLUMN reports.category IS 'Category of the violation (harassment, inappropriate_content, etc.)';
COMMENT ON COLUMN reports.status IS 'Current status of the report in moderation workflow';
COMMENT ON COLUMN reports.message_id IS 'ID of the specific message being reported (content reports only)';
COMMENT ON COLUMN reports.content_sender_id IS 'ID of the user who sent the reported content';

-- Create a view for moderation dashboard (optional)
CREATE OR REPLACE VIEW moderation_reports_view AS
SELECT 
  r.*,
  ru.pseudo as reported_user_display_name,
  rep.pseudo as reporter_display_name,
  CASE 
    WHEN r.report_type = 'content' THEN 'Contenu: ' || COALESCE(r.content_type, 'Unknown')
    ELSE 'Utilisateur: ' || COALESCE(r.reported_user_pseudo, 'Unknown')
  END as report_summary,
  AGE(NOW(), r.created_at) as report_age
FROM reports r
LEFT JOIN users ru ON ru.id = r.reported_user_id
LEFT JOIN users rep ON rep.id = r.reporter_id
ORDER BY r.created_at DESC;

COMMENT ON VIEW moderation_reports_view IS 'Enhanced view of reports with user details for moderation dashboard';
