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
            referenceTable: 'auth.users',
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
            referenceTable: 'auth.users',
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
            referenceTable: 'auth.users',
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
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  icon VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Pages table (with hierarchical structure)
CREATE TABLE pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE,
  parent_page_id UUID REFERENCES pages(id) ON UPDATE CASCADE ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE,
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
  user_id UUID NOT NULL REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  permission VARCHAR(20) NOT NULL CHECK (permission IN ('view', 'edit', 'admin')),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(page_id, user_id)
);

-- Attachments table (files stored in InsForge storage)
CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id) ON UPDATE CASCADE ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE,
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
