import { DatabaseTemplate } from './index';

export const redditCloneTemplate: DatabaseTemplate = {
  id: 'reddit-clone',
  title: 'Reddit Clone',
  description: 'A community space with posts, comments, threaded replies, and voting',
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
            referenceTable: 'auth.users',
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
            referenceTable: 'auth.users',
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
            referenceTable: 'auth.users',
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
            referenceTable: 'auth.users',
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
            referenceTable: 'auth.users',
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
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Posts table
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id) ON UPDATE CASCADE ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE,
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
  post_id UUID NOT NULL REFERENCES posts(id) ON UPDATE CASCADE ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES comments(id) ON UPDATE CASCADE ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (LENGTH(TRIM(content)) > 0),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Votes table (for both posts and comments)
CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  post_id UUID REFERENCES posts(id) ON UPDATE CASCADE ON DELETE CASCADE,
  comment_id UUID REFERENCES comments(id) ON UPDATE CASCADE ON DELETE CASCADE,
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
  community_id UUID NOT NULL REFERENCES communities(id) ON UPDATE CASCADE ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE,
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

-- =======================
-- ROW LEVEL SECURITY (RLS)
-- =======================

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
