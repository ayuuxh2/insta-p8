-- Create users table to store Instagram accounts.
-- business_account_id / page_id are part of the table (not only of schema.sql)
-- because indexes further down reference them; a fresh run of this script must
-- create the columns before those indexes.
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  token_expires_at TIMESTAMP WITH TIME ZONE,
  business_account_id BIGINT,
  page_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Installs created before these columns existed: add them idempotently, before
-- any index below needs them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS business_account_id BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS page_id TEXT;

-- Create conversations table to store DM threads
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id BIGINT NOT NULL,
  recipient_username TEXT NOT NULL,
  last_message_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create messages table to store DM history
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id BIGINT NOT NULL,
  sender_username TEXT NOT NULL,
  content TEXT NOT NULL,
  is_from_instagram BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create webhook events table for debugging + at-most-once delivery claims
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  user_id BIGINT,
  event_key TEXT,
  data JSONB,
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS event_key TEXT;

-- Atomic idempotency: concurrent duplicate deliveries hit a unique violation
-- (23505) instead of racing a SELECT-then-INSERT check.
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_event_key
  ON webhook_events(event_key)
  WHERE event_key IS NOT NULL;

-- Added automations table for keyword/postback rules and post-specific triggering
CREATE TABLE IF NOT EXISTS automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_value TEXT NOT NULL,
  specific_media_id TEXT DEFAULT NULL,
  response_type TEXT DEFAULT 'pro',
  response_content JSONB NOT NULL,
  trigger_source TEXT NOT NULL DEFAULT 'comment',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Same reasoning as users above: indexes reference these columns, so they must
-- exist for installs created before the columns were introduced.
ALTER TABLE automations ADD COLUMN IF NOT EXISTS trigger_source TEXT NOT NULL DEFAULT 'comment';

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_user_id ON webhook_events(user_id);
-- Direct account resolution for incoming webhooks (entry.id -> users row).
CREATE INDEX IF NOT EXISTS idx_users_business_account_id ON users(business_account_id);
CREATE INDEX IF NOT EXISTS idx_users_page_id ON users(page_id);
CREATE INDEX IF NOT EXISTS idx_automations_user_id ON automations(user_id);
CREATE INDEX IF NOT EXISTS idx_automations_specific_media_id ON automations(specific_media_id);
