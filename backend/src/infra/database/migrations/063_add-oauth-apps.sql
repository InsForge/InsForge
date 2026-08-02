-- 1. Table for developers registering their 3rd-party OAuth Apps
CREATE TABLE public.oauth_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    website TEXT NOT NULL,
    icon_url TEXT,
    client_id TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
    client_secret_hash TEXT NOT NULL,
    redirect_uris TEXT[] NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Table for tracking which apps users have installed/authorized
CREATE TABLE public.oauth_authorizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES public.oauth_applications(id) ON DELETE CASCADE,
    project_id UUID NOT NULL, -- The InsForge project they authorized
    user_id UUID NOT NULL,    -- The user who granted access
    scopes TEXT[] NOT NULL,   -- e.g., ['database:write', 'logs:read']
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (app_id, project_id)
);
