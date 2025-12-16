---
name: insforge-schema-patterns
description: Database schema patterns for InsForge including social graphs, e-commerce, content publishing, and multi-tenancy with RLS policies. Use when designing data models with relationships, foreign keys, or Row Level Security.
---

# InsForge Schema Patterns

Expert patterns for designing PostgreSQL schemas optimized for InsForge's PostgREST backend.

## Pattern 1: Social Graph (Follows)

**Use when:** Building social features like Twitter, Instagram, LinkedIn connections

**Schema:**
```sql
CREATE TABLE follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(follower_id, following_id)
);

-- Index for fast lookups
CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_following ON follows(following_id);

-- RLS: Users can read all follows but only create their own
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read follows" ON follows
  FOR SELECT USING (true);

CREATE POLICY "Users can follow others" ON follows
  FOR INSERT
  TO authenticated
  WITH CHECK (uid() = follower_id);

CREATE POLICY "Users can unfollow" ON follows
  FOR DELETE
  TO authenticated
  USING (uid() = follower_id);
```

**Query with InsForge SDK:**
```javascript
// Get users I follow
const { data: following } = await client.database
  .from('follows')
  .select()
  .eq('follower_id', currentUserId);

// Get my followers
const { data: followers } = await client.database
  .from('follows')
  .select()
  .eq('following_id', currentUserId);

// Check if user1 follows user2
const { data: isFollowing } = await client.database
  .from('follows')
  .select()
  .eq('follower_id', user1Id)
  .eq('following_id', user2Id)
  .single();

// Follow a user
await client.database
  .from('follows')
  .insert([{ follower_id: currentUserId, following_id: targetUserId }]);
```

---

## Pattern 2: Likes (Many-to-Many Junction Table)

**Use when:** Users can like posts, comments, or other content

**Schema:**
```sql
CREATE TABLE likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, post_id)  -- Prevent duplicate likes
);

CREATE INDEX idx_likes_post ON likes(post_id);
CREATE INDEX idx_likes_user ON likes(user_id);

ALTER TABLE likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read likes" ON likes
  FOR SELECT USING (true);

CREATE POLICY "Users can like posts" ON likes
  FOR INSERT
  TO authenticated
  WITH CHECK (uid() = user_id);

CREATE POLICY "Users can unlike their likes" ON likes
  FOR DELETE
  TO authenticated
  USING (uid() = user_id);
```

**Query with InsForge SDK:**
```javascript
// Get post with like count and whether current user liked it
const { data: post } = await client.database
  .from('posts')
  .select(`
    *,
    likes(count),
    user_like:likes!inner(id, user_id)
  `)
  .eq('id', postId)
  .eq('user_like.user_id', currentUserId)
  .single();

// Like a post
await client.database
  .from('likes')
  .insert([{ user_id: currentUserId, post_id: postId }]);

// Unlike a post
await client.database
  .from('likes')
  .delete()
  .eq('user_id', currentUserId)
  .eq('post_id', postId);
```

---

## Pattern 3: Nested Comments (Self-Referential)

**Use when:** Building comment threads, nested replies

**Schema:**
```sql
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comments_post ON comments(post_id);
CREATE INDEX idx_comments_parent ON comments(parent_comment_id);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read comments" ON comments
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can comment" ON comments
  FOR INSERT
  TO authenticated
  WITH CHECK (uid() = user_id);

CREATE POLICY "Users can edit their comments" ON comments
  FOR UPDATE
  TO authenticated
  USING (uid() = user_id)
  WITH CHECK (uid() = user_id);

CREATE POLICY "Users can delete their comments" ON comments
  FOR DELETE
  TO authenticated
  USING (uid() = user_id);
```

**Query with InsForge SDK:**
```javascript
// Get top-level comments with author info
// Note: profile is a JSONB column containing { name, avatar_url, bio, birthday }
const { data: comments } = await client.database
  .from('comments')
  .select('*, author:user_id(id, profile)')
  .eq('post_id', postId)
  .is('parent_comment_id', null)
  .order('created_at', { ascending: false });

// Access author info: comment.author.profile.name, comment.author.profile.avatar_url

// Get replies to a comment
const { data: replies } = await client.database
  .from('comments')
  .select('*, author:user_id(id, profile)')
  .eq('parent_comment_id', commentId)
  .order('created_at', { ascending: true });
```

---

## Pattern 4: Multi-Tenant (Organization Scoped)

**Use when:** Building SaaS apps where data is scoped to organizations/workspaces

**Schema:**
```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE organization_members (
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: Users can only see projects in their organizations
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see org projects" ON projects
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = uid()
    )
  );

CREATE POLICY "Admins can create projects" ON projects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = uid()
      AND role IN ('owner', 'admin')
    )
  );
```

---

## Best Practices

1. **Always add indexes** on foreign key columns for performance
2. **Use UNIQUE constraints** on junction tables to prevent duplicates
3. **Enable RLS** on all user-facing tables
4. **Use ON DELETE CASCADE** for automatic cleanup
5. **Foreign key expansion** in SDK uses the syntax: `table:column(fields)`
6. **Count aggregations** use: `table(count)`
7. **Filter nested tables** with: `nested_table!inner()` for inner join behavior

## Common Mistakes to Avoid

- ❌ Forgetting indexes on foreign keys → Slow queries
- ❌ Not using UNIQUE on junction tables → Duplicate likes/follows
- ❌ Missing RLS policies → Data leaks
- ❌ Using `.single()` on queries that might return multiple rows → Errors
- ❌ Not wrapping INSERT data in arrays → PostgREST error
