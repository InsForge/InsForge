import { DatabaseTemplate } from './index';

export const instagramCloneTemplate: DatabaseTemplate = {
  id: 'instagram-clone',
  title: 'Instagram Clone',
  description: 'An Instagram-style photo sharing app with posts, comments, likes, and follows',
  tableCount: 4,
  visualizerSchema: [
    {
      tableName: 'posts',
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
          columnName: 'image_url',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'caption',
          type: 'text',
          isPrimaryKey: false,
          isNullable: true,
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
      tableName: 'likes',
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
          columnName: 'created_at',
          type: 'timestamp',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
      ],
    },
    {
      tableName: 'follows',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'follower_id',
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
          columnName: 'following_id',
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
          columnName: 'created_at',
          type: 'timestamp',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
      ],
    },
  ],
  sql: `-- Instagram Clone Database Schema

-- Posts table
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_url VARCHAR(500) NOT NULL,
  caption TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Comments table
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (LENGTH(TRIM(content)) > 0),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Likes table
CREATE TABLE likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, post_id)
);

-- Follows table
CREATE TABLE follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(follower_id, following_id),
  CHECK (follower_id != following_id)
);

-- Create indexes for better performance
CREATE INDEX idx_posts_user ON posts(user_id);
CREATE INDEX idx_posts_created ON posts(created_at DESC);
CREATE INDEX idx_posts_active ON posts(is_active);
CREATE INDEX idx_comments_post ON comments(post_id);
CREATE INDEX idx_comments_user ON comments(user_id);
CREATE INDEX idx_comments_active ON comments(is_active);
CREATE INDEX idx_likes_post ON likes(post_id);
CREATE INDEX idx_likes_user ON likes(user_id);
CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_following ON follows(following_id);

-- Database Functions

-- Get post engagement statistics
CREATE OR REPLACE FUNCTION get_post_stats(post_id_param UUID)
RETURNS TABLE(
  post_id UUID,
  like_count BIGINT,
  comment_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
    (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND is_active = true) as comment_count
  FROM posts p
  WHERE p.id = post_id_param;
END;
$$ LANGUAGE plpgsql;

-- Get user statistics
CREATE OR REPLACE FUNCTION get_user_stats(user_id_param UUID)
RETURNS TABLE(
  user_id UUID,
  post_count BIGINT,
  follower_count BIGINT,
  following_count BIGINT,
  total_likes_received BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    user_id_param,
    (SELECT COUNT(*) FROM posts WHERE user_id = user_id_param AND is_active = true) as post_count,
    (SELECT COUNT(*) FROM follows WHERE following_id = user_id_param) as follower_count,
    (SELECT COUNT(*) FROM follows WHERE follower_id = user_id_param) as following_count,
    (SELECT COUNT(*) FROM likes l
     JOIN posts p ON l.post_id = p.id
     WHERE p.user_id = user_id_param) as total_likes_received;
END;
$$ LANGUAGE plpgsql;

-- Check if user has liked a post
CREATE OR REPLACE FUNCTION has_user_liked_post(
  user_id_param UUID,
  post_id_param UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS(
    SELECT 1 FROM likes
    WHERE user_id = user_id_param AND post_id = post_id_param
  );
END;
$$ LANGUAGE plpgsql;

-- Check if user follows another user
CREATE OR REPLACE FUNCTION is_following(
  follower_id_param UUID,
  following_id_param UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS(
    SELECT 1 FROM follows
    WHERE follower_id = follower_id_param AND following_id = following_id_param
  );
END;
$$ LANGUAGE plpgsql;

-- Get user feed (posts from followed users)
CREATE OR REPLACE FUNCTION get_user_feed(
  user_id_param UUID,
  limit_param INTEGER DEFAULT 20,
  offset_param INTEGER DEFAULT 0
)
RETURNS TABLE(
  post_id UUID,
  user_id UUID,
  image_url VARCHAR,
  caption TEXT,
  created_at TIMESTAMP,
  like_count BIGINT,
  comment_count BIGINT,
  has_liked BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.user_id,
    p.image_url,
    p.caption,
    p.created_at,
    (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
    (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND is_active = true) as comment_count,
    EXISTS(SELECT 1 FROM likes WHERE user_id = user_id_param AND post_id = p.id) as has_liked
  FROM posts p
  WHERE p.is_active = true
    AND p.user_id IN (
      SELECT following_id FROM follows WHERE follower_id = user_id_param
    )
  ORDER BY p.created_at DESC
  LIMIT limit_param
  OFFSET offset_param;
END;
$$ LANGUAGE plpgsql;

-- Get explore feed (popular posts)
CREATE OR REPLACE FUNCTION get_explore_feed(
  limit_param INTEGER DEFAULT 20,
  offset_param INTEGER DEFAULT 0
)
RETURNS TABLE(
  post_id UUID,
  user_id UUID,
  image_url VARCHAR,
  caption TEXT,
  created_at TIMESTAMP,
  like_count BIGINT,
  comment_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.user_id,
    p.image_url,
    p.caption,
    p.created_at,
    (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
    (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND is_active = true) as comment_count
  FROM posts p
  WHERE p.is_active = true
  ORDER BY
    (SELECT COUNT(*) FROM likes WHERE post_id = p.id) DESC,
    p.created_at DESC
  LIMIT limit_param
  OFFSET offset_param;
END;
$$ LANGUAGE plpgsql;

-- Get post comments with user info simulation
CREATE OR REPLACE FUNCTION get_post_comments(
  post_id_param UUID,
  limit_param INTEGER DEFAULT 50,
  offset_param INTEGER DEFAULT 0
)
RETURNS TABLE(
  comment_id UUID,
  user_id UUID,
  content TEXT,
  created_at TIMESTAMP
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.user_id,
    c.content,
    c.created_at
  FROM comments c
  WHERE c.post_id = post_id_param
    AND c.is_active = true
  ORDER BY c.created_at ASC
  LIMIT limit_param
  OFFSET offset_param;
END;
$$ LANGUAGE plpgsql;

-- Get mutual followers
CREATE OR REPLACE FUNCTION get_mutual_followers(
  user_id_1 UUID,
  user_id_2 UUID
)
RETURNS TABLE(
  mutual_follower_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT f1.follower_id
  FROM follows f1
  INNER JOIN follows f2 ON f1.follower_id = f2.follower_id
  WHERE f1.following_id = user_id_1
    AND f2.following_id = user_id_2;
END;
$$ LANGUAGE plpgsql;

-- Triggers

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
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

-- Posts policies: Users can view all active posts, but only modify their own
CREATE POLICY posts_select_policy ON posts
  FOR SELECT
  USING (is_active = true);

CREATE POLICY posts_insert_policy ON posts
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY posts_update_policy ON posts
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY posts_delete_policy ON posts
  FOR DELETE
  USING (auth.uid() = user_id);

-- Comments policies: Users can view active comments, create their own, and modify/delete their own
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

-- Likes policies: Users can view all likes, create their own, and delete their own
CREATE POLICY likes_select_policy ON likes
  FOR SELECT
  USING (true);

CREATE POLICY likes_insert_policy ON likes
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY likes_delete_policy ON likes
  FOR DELETE
  USING (auth.uid() = user_id);

-- Follows policies: Users can view all follows, create their own, and delete their own
CREATE POLICY follows_select_policy ON follows
  FOR SELECT
  USING (true);

CREATE POLICY follows_insert_policy ON follows
  FOR INSERT
  WITH CHECK (auth.uid() = follower_id);

CREATE POLICY follows_delete_policy ON follows
  FOR DELETE
  USING (auth.uid() = follower_id);`,
};
