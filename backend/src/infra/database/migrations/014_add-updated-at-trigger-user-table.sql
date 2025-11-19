-- Migration: 014 - Add updated_at trigger to users table
-- Adds the updated_at trigger to the users table for automatic timestamp management


DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();