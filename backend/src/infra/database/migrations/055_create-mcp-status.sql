-- Migration: 052 - Create mcp_status table for tracking connection state

CREATE TABLE IF NOT EXISTS system.mcp_status (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status VARCHAR(50) NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected')),
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Seed default initial state
INSERT INTO system.mcp_status (id, status)
VALUES (1, 'disconnected')
ON CONFLICT (id) DO NOTHING;
