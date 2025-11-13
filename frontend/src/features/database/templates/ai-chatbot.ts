import { DatabaseTemplate } from './index';

export const aiChatbotTemplate: DatabaseTemplate = {
  id: 'ai-chatbot',
  title: 'AI Chatbot',
  description:
    'A chatbot app with conversations, message history, image uploads, and user specific data',
  tableCount: 4,
  visualizerSchema: [
    {
      tableName: 'conversations',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'user_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          foreignKey: {
            referenceTable: 'users',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'title',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'model',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'created_at',
          type: 'timestamp',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'updated_at',
          type: 'timestamp',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
      ],
    },
    {
      tableName: 'messages',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'conversation_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          foreignKey: {
            referenceTable: 'conversations',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'role',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'content',
          type: 'text',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'tokens_used',
          type: 'integer',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'created_at',
          type: 'timestamp',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
      ],
    },
    {
      tableName: 'feedback',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'message_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          foreignKey: {
            referenceTable: 'messages',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'user_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          foreignKey: {
            referenceTable: 'users',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'rating',
          type: 'integer',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'comment',
          type: 'text',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'created_at',
          type: 'timestamp',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
      ],
    },
    {
      tableName: 'prompts',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'user_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          foreignKey: {
            referenceTable: 'users',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'title',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'content',
          type: 'text',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'category',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'is_public',
          type: 'boolean',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'usage_count',
          type: 'integer',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'created_at',
          type: 'timestamp',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'updated_at',
          type: 'timestamp',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
      ],
    },
  ],
  sql: `-- AI Chatbot Database Schema
-- A comprehensive AI chatbot system with conversations, messages, feedback, and prompt library

-- Conversations table
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  title VARCHAR(255),
  model VARCHAR(100) DEFAULT 'gpt-4',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Messages table
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON UPDATE CASCADE ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  tokens_used INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Feedback table
CREATE TABLE feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON UPDATE CASCADE ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Prompts library table
CREATE TABLE prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  category VARCHAR(100),
  is_public BOOLEAN DEFAULT FALSE,
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_conversations_user ON conversations(user_id);
CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_role ON messages(role);
CREATE INDEX idx_messages_created ON messages(created_at DESC);
CREATE INDEX idx_feedback_message ON feedback(message_id);
CREATE INDEX idx_feedback_user ON feedback(user_id);
CREATE INDEX idx_feedback_rating ON feedback(rating);
CREATE INDEX idx_prompts_user ON prompts(user_id);
CREATE INDEX idx_prompts_category ON prompts(category);
CREATE INDEX idx_prompts_public ON prompts(is_public) WHERE is_public = TRUE;

-- =======================
-- DATABASE FUNCTIONS
-- =======================

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to auto-update conversation timestamp when a message is added
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations
  SET updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to increment prompt usage count
CREATE OR REPLACE FUNCTION increment_prompt_usage()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE prompts
  SET usage_count = usage_count + 1
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to get conversation message count
CREATE OR REPLACE FUNCTION get_conversation_message_count(conversation_id_param UUID)
RETURNS INTEGER AS $$
DECLARE
  message_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO message_count
  FROM messages
  WHERE conversation_id = conversation_id_param;
  RETURN message_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get conversation total tokens
CREATE OR REPLACE FUNCTION get_conversation_total_tokens(conversation_id_param UUID)
RETURNS INTEGER AS $$
DECLARE
  total_tokens INTEGER;
BEGIN
  SELECT COALESCE(SUM(tokens_used), 0) INTO total_tokens
  FROM messages
  WHERE conversation_id = conversation_id_param;
  RETURN total_tokens;
END;
$$ LANGUAGE plpgsql;

-- Function to get user's total token usage
CREATE OR REPLACE FUNCTION get_user_total_tokens(user_id_param UUID)
RETURNS INTEGER AS $$
DECLARE
  total_tokens INTEGER;
BEGIN
  SELECT COALESCE(SUM(m.tokens_used), 0) INTO total_tokens
  FROM messages m
  JOIN conversations c ON m.conversation_id = c.id
  WHERE c.user_id = user_id_param;
  RETURN total_tokens;
END;
$$ LANGUAGE plpgsql;

-- Function to get average message rating
CREATE OR REPLACE FUNCTION get_message_average_rating(message_id_param UUID)
RETURNS DECIMAL AS $$
DECLARE
  avg_rating DECIMAL;
BEGIN
  SELECT COALESCE(AVG(rating), 0) INTO avg_rating
  FROM feedback
  WHERE message_id = message_id_param;
  RETURN avg_rating;
END;
$$ LANGUAGE plpgsql;

-- Function to get popular prompts
CREATE OR REPLACE FUNCTION get_popular_prompts(limit_count INTEGER DEFAULT 10)
RETURNS TABLE(
  id UUID,
  title VARCHAR,
  category VARCHAR,
  usage_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.title, p.category, p.usage_count
  FROM prompts p
  WHERE p.is_public = TRUE
  ORDER BY p.usage_count DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get feedback statistics
CREATE OR REPLACE FUNCTION get_feedback_statistics()
RETURNS TABLE(
  rating INTEGER,
  count BIGINT,
  percentage DECIMAL
) AS $$
DECLARE
  total_feedback BIGINT;
BEGIN
  SELECT COUNT(*) INTO total_feedback FROM feedback;

  RETURN QUERY
  SELECT
    f.rating,
    COUNT(*) as count,
    CASE
      WHEN total_feedback > 0 THEN ROUND((COUNT(*) * 100.0 / total_feedback), 2)
      ELSE 0
    END as percentage
  FROM feedback f
  GROUP BY f.rating
  ORDER BY f.rating DESC;
END;
$$ LANGUAGE plpgsql;

-- =======================
-- TRIGGERS
-- =======================

-- Trigger to update updated_at on conversations
CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update updated_at on prompts
CREATE TRIGGER update_prompts_updated_at
  BEFORE UPDATE ON prompts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update conversation timestamp when message is added
CREATE TRIGGER update_conversation_on_message
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_timestamp();

-- =======================
-- ROW LEVEL SECURITY (RLS)
-- =======================

-- Enable RLS on all tables
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;

-- Policies for conversations (users can only see their own)
CREATE POLICY "Users can view their own conversations"
  ON conversations FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create their own conversations"
  ON conversations FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own conversations"
  ON conversations FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own conversations"
  ON conversations FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Policies for messages (users can only see messages from their conversations)
CREATE POLICY "Users can view messages from their conversations"
  ON messages FOR SELECT
  TO authenticated
  USING (
    conversation_id IN (
      SELECT id FROM conversations WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create messages in their conversations"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    conversation_id IN (
      SELECT id FROM conversations WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update messages in their conversations"
  ON messages FOR UPDATE
  TO authenticated
  USING (
    conversation_id IN (
      SELECT id FROM conversations WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    conversation_id IN (
      SELECT id FROM conversations WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete messages from their conversations"
  ON messages FOR DELETE
  TO authenticated
  USING (
    conversation_id IN (
      SELECT id FROM conversations WHERE user_id = auth.uid()
    )
  );

-- Policies for feedback
CREATE POLICY "Users can view their own feedback"
  ON feedback FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create their own feedback"
  ON feedback FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own feedback"
  ON feedback FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own feedback"
  ON feedback FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Policies for prompts (users can see their own and public prompts)
CREATE POLICY "Users can view their own and public prompts"
  ON prompts FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR is_public = TRUE);

CREATE POLICY "Users can create their own prompts"
  ON prompts FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own prompts"
  ON prompts FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own prompts"
  ON prompts FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());`,
};
