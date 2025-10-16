# Microsoft OAuth Login Setup Guide

## Overview
This project supports Microsoft OAuth login via the Microsoft identity platform (Azure AD). After a successful login, the backend issues an app JWT and redirects back to your app.

## Environment Variable Configuration
Add these to your `.env` (or environment) configuration:
```env
MICROSOFT_CLIENT_ID=your_microsoft_client_id
MICROSOFT_CLIENT_SECRET=your_microsoft_client_secret
```

## Azure App Registration Setup
1. Go to the Azure Portal (`https://portal.azure.com`) → Azure Active Directory → App registrations.
2. New registration:
   - Supported account types: pick what you need (e.g., “Accounts in any organizational directory and personal Microsoft accounts”).
   - Redirect URI (Web): `http://localhost:7130/api/auth/oauth/microsoft/callback`
3. Certificates & secrets → New client secret. Copy the secret value (only shown once).
4. API permissions → Add permission → Microsoft Graph → Delegated → add:
   - User.Read
5. Save your:
   - Application (client) ID → `MICROSOFT_CLIENT_ID`
   - Client secret → `MICROSOFT_CLIENT_SECRET`

Authorized redirect URIs:
- Development: `http://localhost:7130/api/auth/oauth/microsoft/callback`
- Production: `https://yourdomain.com/api/auth/oauth/microsoft/callback`

## API Endpoints

### 1) Get Microsoft OAuth Authorization URL
Endpoint: `GET /api/auth/oauth/microsoft?redirect_uri={YOUR_APP_URL_AFTER_LOGIN}`

Response:
```json
{ "authUrl": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?..." }
```

Example:
```bash
curl "http://localhost:7130/api/auth/oauth/microsoft?redirect_uri=http://localhost:7131/dashboard"
```

### 2) Microsoft OAuth Callback Handling
Endpoint: `GET /api/auth/oauth/microsoft/callback?code=...&state=...`

Process:
1. Receive authorization `code`.
2. Exchange `code` for `access_token` (and optional `id_token`) from Microsoft.
3. Fetch profile from Microsoft Graph (`/v1.0/me`) to get user info (id, email, displayName).
4. Find or create local user and issue our app JWT.
5. Redirect to the original `redirect_uri` with token and user info.
