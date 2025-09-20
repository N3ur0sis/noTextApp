#!/bin/bash

# Deploy NoText Report System to Supabase
# This script sets up the complete reporting infrastructure

echo "🚀 Deploying NoText Report System..."

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found. Please install it first:"
    echo "npm install -g supabase"
    exit 1
fi

# Check if we're logged in
if ! supabase projects list &> /dev/null; then
    echo "❌ Please login to Supabase first:"
    echo "supabase login"
    exit 1
fi

echo "📊 Deploying database schema..."
# Deploy the reports table
supabase db push

if [ $? -eq 0 ]; then
    echo "✅ Database schema deployed successfully"
else
    echo "❌ Failed to deploy database schema"
    exit 1
fi

echo "⚡ Deploying Edge Function..."
# Deploy the report Edge Function
supabase functions deploy report --no-verify-jwt

if [ $? -eq 0 ]; then
    echo "✅ Edge Function deployed successfully"
else
    echo "❌ Failed to deploy Edge Function"
    exit 1
fi

echo ""
echo "🎉 NoText Report System deployed successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Test the API endpoint in your app"
echo "2. Configure email notifications if desired"
echo "3. Set up moderation dashboard access"
echo "4. Update your Apple App Store submission"
echo ""
echo "📖 See supabase/functions/README.md for detailed setup instructions"
