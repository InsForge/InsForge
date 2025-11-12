import { DatabaseTemplate } from './index';

export const redditCloneTemplate: DatabaseTemplate = {
  id: 'reddit-clone',
  title: 'Reddit Clone',
  description: 'A Reddit-style community platform with subreddits, posts, comments, and voting',
  tableCount: 5,
  visualizerSchema: [
    {
      tableName: 'communities',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'name',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: true,
        },
        {
          columnName: 'display_name',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'description',
          type: 'text',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'creator_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
          foreignKey: {
            referenceTable: 'users',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'is_active',
          type: 'boolean',
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
      tableName: 'posts',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'community_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
          foreignKey: {
            referenceTable: 'communities',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'user_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: false,
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
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'link_url',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'post_type',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'is_active',
          type: 'boolean',
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
      tableName: 'comments',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'post_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
          foreignKey: {
            referenceTable: 'posts',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'user_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
          foreignKey: {
            referenceTable: 'users',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'parent_comment_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          foreignKey: {
            referenceTable: 'comments',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'content',
          type: 'text',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'is_active',
          type: 'boolean',
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
      tableName: 'votes',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'user_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
          foreignKey: {
            referenceTable: 'users',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'post_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          foreignKey: {
            referenceTable: 'posts',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'comment_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          foreignKey: {
            referenceTable: 'comments',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'vote_type',
          type: 'integer',
          isPrimaryKey: false,
          isNullable: false,
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
      tableName: 'community_members',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'community_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
          foreignKey: {
            referenceTable: 'communities',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'user_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
          foreignKey: {
            referenceTable: 'users',
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
          columnName: 'created_at',
          type: 'timestamp',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
      ],
    },
  ],
  sql: `-- Reddit Clone Database Schema
-- A community-based platform with subreddits, posts, threaded comments, and voting

-- Communities table (subreddits)
CREATE TABLE communities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) UNIQUE NOT NULL CHECK (name ~ '^[a-zA-Z0-9_]+$'),
  display_name VARCHAR(200) NOT NULL,
  description TEXT,
  creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Posts table
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL CHECK (LENGTH(TRIM(title)) > 0),
  content TEXT,
  link_url VARCHAR(500),
  post_type VARCHAR(20) NOT NULL CHECK (post_type IN ('text', 'link', 'image')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CHECK (
    (post_type = 'text' AND content IS NOT NULL) OR
    (post_type = 'link' AND link_url IS NOT NULL) OR
    (post_type = 'image' AND link_url IS NOT NULL)
  )
);

-- Comments table (with threading support)
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (LENGTH(TRIM(content)) > 0),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Votes table (for both posts and comments)
CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  vote_type INTEGER NOT NULL CHECK (vote_type IN (-1, 1)),
  created_at TIMESTAMP DEFAULT NOW(),
  CHECK (
    (post_id IS NOT NULL AND comment_id IS NULL) OR
    (post_id IS NULL AND comment_id IS NOT NULL)
  ),
  UNIQUE(user_id, post_id),
  UNIQUE(user_id, comment_id)
);

-- Community members table (subscriptions and roles)
CREATE TABLE community_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'moderator', 'admin')),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(community_id, user_id)
);

-- Create indexes for better performance
CREATE INDEX idx_communities_name ON communities(name);
CREATE INDEX idx_communities_creator ON communities(creator_id);
CREATE INDEX idx_communities_active ON communities(is_active);
CREATE INDEX idx_posts_community ON posts(community_id);
CREATE INDEX idx_posts_user ON posts(user_id);
CREATE INDEX idx_posts_created ON posts(created_at DESC);
CREATE INDEX idx_posts_active ON posts(is_active);
CREATE INDEX idx_comments_post ON comments(post_id);
CREATE INDEX idx_comments_user ON comments(user_id);
CREATE INDEX idx_comments_parent ON comments(parent_comment_id);
CREATE INDEX idx_comments_created ON comments(created_at ASC);
CREATE INDEX idx_comments_active ON comments(is_active);
CREATE INDEX idx_votes_post ON votes(post_id);
CREATE INDEX idx_votes_comment ON votes(comment_id);
CREATE INDEX idx_votes_user ON votes(user_id);
CREATE INDEX idx_community_members_community ON community_members(community_id);
CREATE INDEX idx_community_members_user ON community_members(user_id);

-- Database Functions

-- Get post score (upvotes - downvotes)
CREATE OR REPLACE FUNCTION get_post_score(post_id_param UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN COALESCE(
    (SELECT SUM(vote_type) FROM votes WHERE post_id = post_id_param),
    0
  );
END;
$$ LANGUAGE plpgsql;

-- Get comment score
CREATE OR REPLACE FUNCTION get_comment_score(comment_id_param UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN COALESCE(
    (SELECT SUM(vote_type) FROM votes WHERE comment_id = comment_id_param),
    0
  );
END;
$$ LANGUAGE plpgsql;

-- Get user's vote on a post
CREATE OR REPLACE FUNCTION get_user_post_vote(
  user_id_param UUID,
  post_id_param UUID
)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT vote_type FROM votes
    WHERE user_id = user_id_param AND post_id = post_id_param
  );
END;
$$ LANGUAGE plpgsql;

-- Get user's vote on a comment
CREATE OR REPLACE FUNCTION get_user_comment_vote(
  user_id_param UUID,
  comment_id_param UUID
)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT vote_type FROM votes
    WHERE user_id = user_id_param AND comment_id = comment_id_param
  );
END;
$$ LANGUAGE plpgsql;

-- Get community statistics
CREATE OR REPLACE FUNCTION get_community_stats(community_id_param UUID)
RETURNS TABLE(
  member_count BIGINT,
  post_count BIGINT,
  comment_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM community_members WHERE community_id = community_id_param) as member_count,
    (SELECT COUNT(*) FROM posts WHERE community_id = community_id_param AND is_active = true) as post_count,
    (SELECT COUNT(*) FROM comments c
     JOIN posts p ON c.post_id = p.id
     WHERE p.community_id = community_id_param AND c.is_active = true) as comment_count;
END;
$$ LANGUAGE plpgsql;

-- Get hot posts (Reddit's "hot" algorithm simplified)
CREATE OR REPLACE FUNCTION get_hot_posts(
  community_id_param UUID DEFAULT NULL,
  limit_param INTEGER DEFAULT 25,
  offset_param INTEGER DEFAULT 0
)
RETURNS TABLE(
  post_id UUID,
  community_id UUID,
  user_id UUID,
  title VARCHAR,
  post_type VARCHAR,
  created_at TIMESTAMP,
  score INTEGER,
  comment_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.community_id,
    p.user_id,
    p.title,
    p.post_type,
    p.created_at,
    COALESCE((SELECT SUM(vote_type) FROM votes WHERE post_id = p.id), 0)::INTEGER as score,
    (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND is_active = true) as comment_count
  FROM posts p
  WHERE p.is_active = true
    AND (community_id_param IS NULL OR p.community_id = community_id_param)
  ORDER BY
    -- Simple hot algorithm: score / (hours since posted + 2)^1.5
    COALESCE((SELECT SUM(vote_type) FROM votes WHERE post_id = p.id), 0) /
    POWER(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600 + 2, 1.5) DESC
  LIMIT limit_param
  OFFSET offset_param;
END;
$$ LANGUAGE plpgsql;

-- Get user feed (posts from subscribed communities)
CREATE OR REPLACE FUNCTION get_user_feed(
  user_id_param UUID,
  limit_param INTEGER DEFAULT 25,
  offset_param INTEGER DEFAULT 0
)
RETURNS TABLE(
  post_id UUID,
  community_id UUID,
  community_name VARCHAR,
  user_id UUID,
  title VARCHAR,
  post_type VARCHAR,
  created_at TIMESTAMP,
  score INTEGER,
  comment_count BIGINT,
  user_vote INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.community_id,
    c.name as community_name,
    p.user_id,
    p.title,
    p.post_type,
    p.created_at,
    COALESCE((SELECT SUM(vote_type) FROM votes WHERE post_id = p.id), 0)::INTEGER as score,
    (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND is_active = true) as comment_count,
    (SELECT vote_type FROM votes WHERE user_id = user_id_param AND post_id = p.id) as user_vote
  FROM posts p
  JOIN communities c ON p.community_id = c.id
  WHERE p.is_active = true
    AND p.community_id IN (
      SELECT community_id FROM community_members WHERE user_id = user_id_param
    )
  ORDER BY p.created_at DESC
  LIMIT limit_param
  OFFSET offset_param;
END;
$$ LANGUAGE plpgsql;

-- Get comment thread (with nested comments)
CREATE OR REPLACE FUNCTION get_comment_thread(post_id_param UUID)
RETURNS TABLE(
  comment_id UUID,
  parent_comment_id UUID,
  user_id UUID,
  content TEXT,
  created_at TIMESTAMP,
  score INTEGER,
  depth INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE comment_tree AS (
    -- Base case: top-level comments
    SELECT
      c.id,
      c.parent_comment_id,
      c.user_id,
      c.content,
      c.created_at,
      COALESCE((SELECT SUM(vote_type) FROM votes WHERE comment_id = c.id), 0)::INTEGER as score,
      0 as depth
    FROM comments c
    WHERE c.post_id = post_id_param AND c.parent_comment_id IS NULL AND c.is_active = true

    UNION ALL

    -- Recursive case: child comments
    SELECT
      c.id,
      c.parent_comment_id,
      c.user_id,
      c.content,
      c.created_at,
      COALESCE((SELECT SUM(vote_type) FROM votes WHERE comment_id = c.id), 0)::INTEGER as score,
      ct.depth + 1
    FROM comments c
    JOIN comment_tree ct ON c.parent_comment_id = ct.comment_id
    WHERE c.is_active = true
  )
  SELECT * FROM comment_tree
  ORDER BY depth, score DESC, created_at ASC;
END;
$$ LANGUAGE plpgsql;

-- Get user karma (total score from all posts and comments)
CREATE OR REPLACE FUNCTION get_user_karma(user_id_param UUID)
RETURNS TABLE(
  post_karma INTEGER,
  comment_karma INTEGER,
  total_karma INTEGER
) AS $$
DECLARE
  p_karma INTEGER;
  c_karma INTEGER;
BEGIN
  SELECT COALESCE(SUM(v.vote_type), 0) INTO p_karma
  FROM votes v
  JOIN posts p ON v.post_id = p.id
  WHERE p.user_id = user_id_param;

  SELECT COALESCE(SUM(v.vote_type), 0) INTO c_karma
  FROM votes v
  JOIN comments c ON v.comment_id = c.id
  WHERE c.user_id = user_id_param;

  RETURN QUERY SELECT p_karma, c_karma, p_karma + c_karma;
END;
$$ LANGUAGE plpgsql;

-- Check if user is community member
CREATE OR REPLACE FUNCTION is_community_member(
  user_id_param UUID,
  community_id_param UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS(
    SELECT 1 FROM community_members
    WHERE user_id = user_id_param AND community_id = community_id_param
  );
END;
$$ LANGUAGE plpgsql;

-- Triggers

-- Auto-update updated_at for communities
CREATE OR REPLACE FUNCTION update_communities_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER communities_updated_at_trigger
BEFORE UPDATE ON communities
FOR EACH ROW
EXECUTE FUNCTION update_communities_updated_at();

-- Auto-update updated_at for posts
CREATE OR REPLACE FUNCTION update_posts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER posts_updated_at_trigger
BEFORE UPDATE ON posts
FOR EACH ROW
EXECUTE FUNCTION update_posts_updated_at();

-- Auto-update updated_at for comments
CREATE OR REPLACE FUNCTION update_comments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER comments_updated_at_trigger
BEFORE UPDATE ON comments
FOR EACH ROW
EXECUTE FUNCTION update_comments_updated_at();

-- Row Level Security (RLS) Policies

-- Enable RLS
ALTER TABLE communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_members ENABLE ROW LEVEL SECURITY;

-- Communities policies: Anyone can view active communities
CREATE POLICY communities_select_policy ON communities
  FOR SELECT
  USING (is_active = true);

CREATE POLICY communities_insert_policy ON communities
  FOR INSERT
  WITH CHECK (auth.uid() = creator_id);

CREATE POLICY communities_update_policy ON communities
  FOR UPDATE
  USING (
    auth.uid() = creator_id OR
    EXISTS(
      SELECT 1 FROM community_members
      WHERE community_id = communities.id
        AND user_id = auth.uid()
        AND role IN ('moderator', 'admin')
    )
  );

CREATE POLICY communities_delete_policy ON communities
  FOR DELETE
  USING (auth.uid() = creator_id);

-- Posts policies: Anyone can view active posts, members can create
CREATE POLICY posts_select_policy ON posts
  FOR SELECT
  USING (is_active = true);

CREATE POLICY posts_insert_policy ON posts
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS(
      SELECT 1 FROM community_members
      WHERE community_id = posts.community_id AND user_id = auth.uid()
    )
  );

CREATE POLICY posts_update_policy ON posts
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY posts_delete_policy ON posts
  FOR DELETE
  USING (auth.uid() = user_id);

-- Comments policies: Anyone can view active comments, authenticated users can create
CREATE POLICY comments_select_policy ON comments
  FOR SELECT
  USING (is_active = true);

CREATE POLICY comments_insert_policy ON comments
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY comments_update_policy ON comments
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY comments_delete_policy ON comments
  FOR DELETE
  USING (auth.uid() = user_id);

-- Votes policies: Users can view all votes, create/update their own
CREATE POLICY votes_select_policy ON votes
  FOR SELECT
  USING (true);

CREATE POLICY votes_insert_policy ON votes
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY votes_update_policy ON votes
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY votes_delete_policy ON votes
  FOR DELETE
  USING (auth.uid() = user_id);

-- Community members policies: Anyone can view, users can manage their own memberships
CREATE POLICY community_members_select_policy ON community_members
  FOR SELECT
  USING (true);

CREATE POLICY community_members_insert_policy ON community_members
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY community_members_delete_policy ON community_members
  FOR DELETE
  USING (auth.uid() = user_id);`,
};
