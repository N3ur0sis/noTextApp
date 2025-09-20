# Supabase Edge Functions Configuration

## Report Function

This directory contains the Edge Function for handling reports in the NoText application.

### Setup Instructions

1. **Install Supabase CLI** (if not already installed):
   ```bash
   npm install -g supabase
   ```

2. **Login to Supabase**:
   ```bash
   supabase login
   ```

3. **Link your project**:
   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   ```

4. **Deploy the reports table** (run the migration):
   ```bash
   supabase db push
   ```

5. **Deploy the Edge Function**:
   ```bash
   supabase functions deploy report
   ```

### Environment Variables

Make sure your Supabase project has the following environment variables set:

- `SUPABASE_URL` - Automatically available
- `SUPABASE_ANON_KEY` - Automatically available
- `SUPABASE_SERVICE_ROLE_KEY` - Automatically available

### Testing the Function

You can test the function locally:

```bash
# Start local development
supabase start

# Serve functions locally
supabase functions serve

# Test the function
curl -X POST http://localhost:54321/functions/v1/report \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "type": "content",
    "reporter": {
      "id": "user-uuid",
      "pseudo": "testuser"
    },
    "reportedUser": {
      "id": "reported-user-uuid", 
      "pseudo": "reporteduser"
    },
    "category": "inappropriate_content",
    "description": "Test report description",
    "message": {
      "id": "message-uuid",
      "sender_id": "reported-user-uuid",
      "content_type": "image",
      "created_at": "2024-01-01T10:00:00Z"
    }
  }'
```

### Email Integration

To enable automatic email notifications, you can:

1. **Use Supabase Email (Recommended)**:
   - Configure SMTP settings in your Supabase dashboard
   - Uncomment the email sending code in the Edge Function

2. **Use External Service** (SendGrid, Mailgun, etc.):
   - Add your service API key to Supabase secrets
   - Update the `sendModerationEmail` function

3. **Use Webhook**:
   - Set up a webhook URL in your backend
   - Update the function to call your webhook

### Database Schema

The reports are stored in the `reports` table with the following structure:

- `id` (UUID) - Primary key
- `reporter_id` (UUID) - ID of the user making the report
- `reported_user_id` (UUID) - ID of the reported user
- `report_type` (TEXT) - 'user' or 'content'
- `category` (TEXT) - Report category
- `description` (TEXT) - Detailed description
- `message_id` (UUID) - For content reports
- `status` (TEXT) - 'pending', 'reviewing', 'resolved', 'dismissed'
- `created_at` (TIMESTAMPTZ) - When the report was created

### Apple App Store Compliance

This implementation provides:

✅ **Professional Backend**: Real API with database storage
✅ **Audit Trail**: All reports are logged with timestamps
✅ **Status Tracking**: Reports have status workflow
✅ **Email Notifications**: Automatic moderation team alerts
✅ **Rate Limiting**: Prevents spam reporting
✅ **User Transparency**: Users can see their own reports
✅ **Secure**: Uses Supabase RLS and authentication

### Moderation Dashboard

Access reports through the Supabase dashboard or create a custom moderation interface using the `moderation_reports_view` view.

### Support

For questions about this implementation, contact the development team.
