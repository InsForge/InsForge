-- Migration: 012 - Add uploaded_by column to _storage table
-- This migration adds a foreign key relationship to track which account uploaded each file

ALTER TABLE _storage
ADD COLUMN uploaded_by UUID REFERENCES _accounts(id) ON DELETE SET NULL;

-- Create an index for better query performance when filtering by uploader
CREATE INDEX IF NOT EXISTS idx_storage_uploaded_by ON _storage(uploaded_by);