import { DatabaseTemplate } from './index';

export const notionCloneTemplate: DatabaseTemplate = {
  id: 'notion-clone',
  title: 'Notion Clone',
  description: 'A notes workspace with pages, search, rich text editing, and flexible access',
  tableCount: 4,
  visualizerSchema: [
    {
      tableName: 'workspaces',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'name',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'owner_id',
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
          columnName: 'icon',
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
      tableName: 'pages',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'workspace_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
          foreignKey: {
            referenceTable: 'workspaces',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'parent_page_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          foreignKey: {
            referenceTable: 'pages',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
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
          columnName: 'icon',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'cover_image',
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
          columnName: 'is_archived',
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
      tableName: 'page_shares',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'page_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
          foreignKey: {
            referenceTable: 'pages',
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
          columnName: 'permission',
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
    {
      tableName: 'attachments',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'page_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
          foreignKey: {
            referenceTable: 'pages',
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
          columnName: 'file_name',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'file_url',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'file_size',
          type: 'integer',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'mime_type',
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
      ],
    },
  ],
  sql: `-- Notion Clone Database Schema
-- A comprehensive notes workspace with pages, hierarchies, sharing, and attachments

-- Workspaces table
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  icon VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Pages table (with hierarchical structure)
CREATE TABLE pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE,
  parent_page_id UUID REFERENCES pages(id) ON UPDATE CASCADE ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL CHECK (LENGTH(TRIM(title)) > 0),
  content TEXT,
  icon VARCHAR(100),
  cover_image VARCHAR(500),
  is_public BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Page shares table (for collaborative editing)
CREATE TABLE page_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id) ON UPDATE CASCADE ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  permission VARCHAR(20) NOT NULL CHECK (permission IN ('view', 'edit', 'admin')),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(page_id, user_id)
);

-- Attachments table (files stored in InsForge storage)
CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id) ON UPDATE CASCADE ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_url VARCHAR(500) NOT NULL,
  file_size INTEGER,
  mime_type VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_workspaces_owner ON workspaces(owner_id);
CREATE INDEX idx_pages_workspace ON pages(workspace_id);
CREATE INDEX idx_pages_parent ON pages(parent_page_id);
CREATE INDEX idx_pages_creator ON pages(creator_id);
CREATE INDEX idx_pages_title ON pages USING gin(to_tsvector('english', title));
CREATE INDEX idx_pages_content ON pages USING gin(to_tsvector('english', content));
CREATE INDEX idx_pages_public ON pages(is_public) WHERE is_public = TRUE;
CREATE INDEX idx_pages_archived ON pages(is_archived);
CREATE INDEX idx_pages_updated ON pages(updated_at DESC);
CREATE INDEX idx_page_shares_page ON page_shares(page_id);
CREATE INDEX idx_page_shares_user ON page_shares(user_id);
CREATE INDEX idx_attachments_page ON attachments(page_id);
CREATE INDEX idx_attachments_user ON attachments(user_id);

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

-- Function to search pages by title and content
CREATE OR REPLACE FUNCTION search_pages(
  search_query TEXT,
  user_id_param UUID,
  limit_param INTEGER DEFAULT 50
)
RETURNS TABLE(
  page_id UUID,
  workspace_id UUID,
  title VARCHAR,
  content_preview TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  rank REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.workspace_id,
    p.title,
    LEFT(p.content, 200) as content_preview,
    p.created_at,
    p.updated_at,
    ts_rank(
      to_tsvector('english', p.title || ' ' || COALESCE(p.content, '')),
      plainto_tsquery('english', search_query)
    ) as rank
  FROM pages p
  WHERE
    p.is_archived = FALSE AND
    (
      p.is_public = TRUE OR
      p.creator_id = user_id_param OR
      EXISTS(
        SELECT 1 FROM page_shares ps
        WHERE ps.page_id = p.id AND ps.user_id = user_id_param
      ) OR
      p.workspace_id IN (
        SELECT id FROM workspaces WHERE owner_id = user_id_param
      )
    ) AND
    to_tsvector('english', p.title || ' ' || COALESCE(p.content, '')) @@
    plainto_tsquery('english', search_query)
  ORDER BY rank DESC, p.updated_at DESC
  LIMIT limit_param;
END;
$$ LANGUAGE plpgsql;

-- Function to get page hierarchy (breadcrumbs)
CREATE OR REPLACE FUNCTION get_page_breadcrumbs(page_id_param UUID)
RETURNS TABLE(
  page_id UUID,
  title VARCHAR,
  depth INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE page_hierarchy AS (
    SELECT
      p.id,
      p.title,
      p.parent_page_id,
      0 as depth
    FROM pages p
    WHERE p.id = page_id_param

    UNION ALL

    SELECT
      p.id,
      p.title,
      p.parent_page_id,
      ph.depth + 1
    FROM pages p
    JOIN page_hierarchy ph ON p.id = ph.parent_page_id
  )
  SELECT ph.id, ph.title, ph.depth
  FROM page_hierarchy ph
  ORDER BY ph.depth DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to get child pages
CREATE OR REPLACE FUNCTION get_child_pages(page_id_param UUID)
RETURNS TABLE(
  page_id UUID,
  title VARCHAR,
  icon VARCHAR,
  is_public BOOLEAN,
  updated_at TIMESTAMP,
  child_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.title,
    p.icon,
    p.is_public,
    p.updated_at,
    (SELECT COUNT(*) FROM pages WHERE parent_page_id = p.id AND is_archived = FALSE) as child_count
  FROM pages p
  WHERE p.parent_page_id = page_id_param AND p.is_archived = FALSE
  ORDER BY p.updated_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to check user page permission
CREATE OR REPLACE FUNCTION check_page_permission(
  page_id_param UUID,
  user_id_param UUID
)
RETURNS VARCHAR AS $$
DECLARE
  page_creator UUID;
  workspace_owner UUID;
  share_permission VARCHAR;
BEGIN
  -- Check if user is the creator
  SELECT creator_id INTO page_creator
  FROM pages
  WHERE id = page_id_param;

  IF page_creator = user_id_param THEN
    RETURN 'admin';
  END IF;

  -- Check if user owns the workspace
  SELECT w.owner_id INTO workspace_owner
  FROM pages p
  JOIN workspaces w ON p.workspace_id = w.id
  WHERE p.id = page_id_param;

  IF workspace_owner = user_id_param THEN
    RETURN 'admin';
  END IF;

  -- Check if page is shared with user
  SELECT permission INTO share_permission
  FROM page_shares
  WHERE page_id = page_id_param AND user_id = user_id_param;

  IF share_permission IS NOT NULL THEN
    RETURN share_permission;
  END IF;

  -- Check if page is public
  IF EXISTS(SELECT 1 FROM pages WHERE id = page_id_param AND is_public = TRUE) THEN
    RETURN 'view';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to get user's recent pages
CREATE OR REPLACE FUNCTION get_recent_pages(
  user_id_param UUID,
  limit_param INTEGER DEFAULT 20
)
RETURNS TABLE(
  page_id UUID,
  workspace_id UUID,
  title VARCHAR,
  icon VARCHAR,
  updated_at TIMESTAMP
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.workspace_id,
    p.title,
    p.icon,
    p.updated_at
  FROM pages p
  WHERE
    p.is_archived = FALSE AND
    (
      p.creator_id = user_id_param OR
      EXISTS(
        SELECT 1 FROM page_shares ps
        WHERE ps.page_id = p.id AND ps.user_id = user_id_param
      ) OR
      p.workspace_id IN (
        SELECT id FROM workspaces WHERE owner_id = user_id_param
      )
    )
  ORDER BY p.updated_at DESC
  LIMIT limit_param;
END;
$$ LANGUAGE plpgsql;

-- Function to get workspace statistics
CREATE OR REPLACE FUNCTION get_workspace_stats(workspace_id_param UUID)
RETURNS TABLE(
  total_pages BIGINT,
  public_pages BIGINT,
  archived_pages BIGINT,
  total_attachments BIGINT,
  total_storage_bytes BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM pages WHERE workspace_id = workspace_id_param) as total_pages,
    (SELECT COUNT(*) FROM pages WHERE workspace_id = workspace_id_param AND is_public = TRUE) as public_pages,
    (SELECT COUNT(*) FROM pages WHERE workspace_id = workspace_id_param AND is_archived = TRUE) as archived_pages,
    (SELECT COUNT(*) FROM attachments a JOIN pages p ON a.page_id = p.id WHERE p.workspace_id = workspace_id_param) as total_attachments,
    (SELECT COALESCE(SUM(a.file_size), 0) FROM attachments a JOIN pages p ON a.page_id = p.id WHERE p.workspace_id = workspace_id_param) as total_storage_bytes;
END;
$$ LANGUAGE plpgsql;

-- Function to move page to different parent
CREATE OR REPLACE FUNCTION move_page(
  page_id_param UUID,
  new_parent_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  -- Check for circular reference
  IF new_parent_id IS NOT NULL THEN
    IF EXISTS(
      WITH RECURSIVE page_tree AS (
        SELECT id, parent_page_id FROM pages WHERE id = new_parent_id
        UNION ALL
        SELECT p.id, p.parent_page_id FROM pages p
        JOIN page_tree pt ON p.id = pt.parent_page_id
      )
      SELECT 1 FROM page_tree WHERE id = page_id_param
    ) THEN
      RAISE EXCEPTION 'Cannot move page: circular reference detected';
    END IF;
  END IF;

  UPDATE pages
  SET parent_page_id = new_parent_id, updated_at = NOW()
  WHERE id = page_id_param;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- =======================
-- TRIGGERS
-- =======================

-- Trigger to update updated_at on workspaces
CREATE TRIGGER update_workspaces_updated_at
  BEFORE UPDATE ON workspaces
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update updated_at on pages
CREATE TRIGGER update_pages_updated_at
  BEFORE UPDATE ON pages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update parent page's updated_at when child is modified
CREATE OR REPLACE FUNCTION update_parent_page_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_page_id IS NOT NULL THEN
    UPDATE pages
    SET updated_at = NOW()
    WHERE id = NEW.parent_page_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_parent_on_page_change
  AFTER INSERT OR UPDATE ON pages
  FOR EACH ROW
  EXECUTE FUNCTION update_parent_page_timestamp();

-- =======================
-- ROW LEVEL SECURITY (RLS)
-- =======================

-- Enable RLS on all tables
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

-- Workspaces policies
CREATE POLICY "Users can view their own workspaces"
  ON workspaces FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "Users can create their own workspaces"
  ON workspaces FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can update their own workspaces"
  ON workspaces FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can delete their own workspaces"
  ON workspaces FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid());

-- Pages policies (complex: public, owned, shared)
CREATE POLICY "Users can view pages they have access to"
  ON pages FOR SELECT
  TO authenticated
  USING (
    is_public = TRUE OR
    creator_id = auth.uid() OR
    workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()) OR
    EXISTS(SELECT 1 FROM page_shares WHERE page_id = pages.id AND user_id = auth.uid())
  );

CREATE POLICY "Users can create pages in their workspaces"
  ON pages FOR INSERT
  TO authenticated
  WITH CHECK (
    creator_id = auth.uid() AND
    workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
  );

CREATE POLICY "Users can update pages they own or have edit access"
  ON pages FOR UPDATE
  TO authenticated
  USING (
    creator_id = auth.uid() OR
    workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()) OR
    EXISTS(
      SELECT 1 FROM page_shares
      WHERE page_id = pages.id AND user_id = auth.uid() AND permission IN ('edit', 'admin')
    )
  );

CREATE POLICY "Users can delete pages they own"
  ON pages FOR DELETE
  TO authenticated
  USING (
    creator_id = auth.uid() OR
    workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
  );

-- Page shares policies
CREATE POLICY "Users can view shares for their pages"
  ON page_shares FOR SELECT
  TO authenticated
  USING (
    EXISTS(
      SELECT 1 FROM pages p
      WHERE p.id = page_shares.page_id AND
      (p.creator_id = auth.uid() OR p.workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()))
    ) OR
    user_id = auth.uid()
  );

CREATE POLICY "Page owners can create shares"
  ON page_shares FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS(
      SELECT 1 FROM pages p
      WHERE p.id = page_shares.page_id AND
      (p.creator_id = auth.uid() OR p.workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()))
    )
  );

CREATE POLICY "Page owners can delete shares"
  ON page_shares FOR DELETE
  TO authenticated
  USING (
    EXISTS(
      SELECT 1 FROM pages p
      WHERE p.id = page_shares.page_id AND
      (p.creator_id = auth.uid() OR p.workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()))
    )
  );

-- Attachments policies
CREATE POLICY "Users can view attachments for pages they can access"
  ON attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS(
      SELECT 1 FROM pages p
      WHERE p.id = attachments.page_id AND
      (
        p.is_public = TRUE OR
        p.creator_id = auth.uid() OR
        p.workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()) OR
        EXISTS(SELECT 1 FROM page_shares WHERE page_id = p.id AND user_id = auth.uid())
      )
    )
  );

CREATE POLICY "Users can create attachments for pages they can edit"
  ON attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND
    EXISTS(
      SELECT 1 FROM pages p
      WHERE p.id = attachments.page_id AND
      (
        p.creator_id = auth.uid() OR
        p.workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()) OR
        EXISTS(
          SELECT 1 FROM page_shares
          WHERE page_id = p.id AND user_id = auth.uid() AND permission IN ('edit', 'admin')
        )
      )
    )
  );

CREATE POLICY "Users can delete their own attachments"
  ON attachments FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());`,
};
