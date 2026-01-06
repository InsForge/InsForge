-- Migration: 019 - Create deployments table in system schema

-- Create deployments table for tracking deployment requests and their status
-- Designed to be provider-agnostic (Vercel, Netlify, Cloudflare, etc.)
--
-- Status flow:
--   WAITING -> UPLOADING -> (Vercel statuses: QUEUED/BUILDING/READY/ERROR/CANCELED)
--   InsForge statuses:
--   - WAITING: Record created, waiting for client to upload zip to S3
--   - UPLOADING: Server is downloading from S3 and uploading to Vercel
--   Vercel statuses (stored directly):
--   - QUEUED: Deployment queued
--   - BUILDING: Deployment building
--   - READY: Deployment ready
--   - ERROR: Deployment failed
--   - CANCELED: Deployment canceled
CREATE TABLE IF NOT EXISTS system.deployments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deployment_id TEXT,  -- Provider's deployment ID, null until deployment starts
  provider TEXT NOT NULL DEFAULT 'vercel',
  status TEXT NOT NULL DEFAULT 'WAITING',
  url TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_deployments_deployment_id ON system.deployments(deployment_id);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON system.deployments(status);
CREATE INDEX IF NOT EXISTS idx_deployments_provider ON system.deployments(provider);
CREATE INDEX IF NOT EXISTS idx_deployments_created_at ON system.deployments(created_at DESC);

-- Add trigger for updated_at
DROP TRIGGER IF EXISTS update_system_deployments_updated_at ON system.deployments;
CREATE TRIGGER update_system_deployments_updated_at BEFORE UPDATE ON system.deployments
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
