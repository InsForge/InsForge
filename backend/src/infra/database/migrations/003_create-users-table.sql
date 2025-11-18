-- Migration: 003 - Create users table for user profiles

DO $$
BEGIN
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY REFERENCES _accounts(id) ON DELETE CASCADE,
      nickname TEXT,
      avatar_url TEXT,
      bio TEXT,
      birthday DATE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    -- Check and create policies only if they don't exist
    -- Allow everyone to read users table
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'users' 
      AND policyname = 'Enable read access for all users'
    ) THEN
      CREATE POLICY "Enable read access for all users" ON users
        FOR SELECT
        USING (true);  -- Allow all reads
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'users' 
      AND policyname = 'Disable delete for users'
    ) THEN
      CREATE POLICY "Disable delete for users" ON users
        FOR DELETE
        TO authenticated
        USING (false);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'users' 
      AND policyname = 'Enable update for users based on user_id'
    ) THEN
      CREATE POLICY "Enable update for users based on user_id" ON users
        FOR UPDATE
        TO authenticated
        USING (uid() = id)
        WITH CHECK (uid() = id);  -- make sure only the owner can update
    END IF;
    
    -- Enable Row Level Security on the users table
    ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    
    -- Grant permissions to anon and authenticated roles
    GRANT SELECT ON users TO anon;
    GRANT SELECT, UPDATE ON users TO authenticated;
END $$;