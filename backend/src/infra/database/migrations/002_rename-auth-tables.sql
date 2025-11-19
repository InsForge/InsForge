-- Migration: 002 - Rename authentication tables to better auth naming convention

DO $$
BEGIN
    -- Handle _account to _oauth_connections
    IF EXISTS (SELECT FROM information_schema.tables 
              WHERE table_name = '_account' AND table_schema = 'public') THEN
        IF EXISTS (SELECT FROM information_schema.tables 
                   WHERE table_name = '_oauth_connections' AND table_schema = 'public') THEN
            -- Both exist, drop the old one
            DROP TABLE _account CASCADE;
        ELSE
            -- Only old exists, rename it
            ALTER TABLE _account RENAME TO _oauth_connections;
        END IF;
    END IF;

    -- Handle _user to _accounts
    IF EXISTS (SELECT FROM information_schema.tables 
              WHERE table_name = '_user' AND table_schema = 'public') THEN
        IF EXISTS (SELECT FROM information_schema.tables 
                   WHERE table_name = '_accounts' AND table_schema = 'public') THEN
            -- Both exist, drop the old one
            DROP TABLE _user CASCADE;
        ELSE
            -- Only old exists, rename it
            ALTER TABLE _user RENAME TO _accounts;
        END IF;
    END IF;
END $$;