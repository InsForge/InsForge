-- Migration: Create deployments tables
-- Description: Add tables for frontend website deployments

-- Ensure pgcrypto extension exists for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Main deployments table
CREATE TABLE IF NOT EXISTS _deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_name VARCHAR(255) NOT NULL,
  subdomain VARCHAR(255) NOT NULL UNIQUE,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'deploying', 'active', 'failed')),
  deployment_url TEXT,
  storage_path TEXT,
  created_by UUID,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deployed_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_deployments_created_by ON _deployments(created_by);
CREATE INDEX idx_deployments_status ON _deployments(status);
CREATE INDEX idx_deployments_created_at ON _deployments(created_at DESC);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_deployments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_deployments_updated_at
  BEFORE UPDATE ON _deployments
  FOR EACH ROW
  EXECUTE FUNCTION update_deployments_updated_at();

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON _deployments TO project_admin;
GRANT SELECT ON _deployments TO authenticated;
