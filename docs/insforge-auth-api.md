# Insforge OSS Authentication API Documentation

## Overview

Insforge uses JWT tokens for user authentication and API keys for database access. 
**Note** Store JWT access tokens in local storage after successful login/register for persistent authentication.

## Base URL
`http://localhost:7130`

## User Authentication

### Register New User
**POST** `/api/auth/register`

Request:
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

Response:
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "user",
    "avatarUrl": null,
    "bio": null
  },
  "accessToken": "jwt-token",
  "message": "Registration successful",
  "nextActions": "You can use this access token to access other endpoints (always add it to HTTP Header 'Authorization', then send requests). Please keep it safe."
}
```

Example curl:
```bash
curl -X POST http://localhost:7130/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securepassword"
  }'
```

### Login User  
**POST** `/api/auth/login`

Request:
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

Response:
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "user",
    "avatarUrl": null,
    "bio": null
  },
  "accessToken": "jwt-token",
  "message": "Login successful",
  "nextActions": "Use the access token in the Authorization header for subsequent requests"
}
```

Example curl:
```bash
curl -X POST http://localhost:7130/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securepassword"
  }'
```

### Get Current User
**GET** `/api/auth/me`

Headers: `Authorization: Bearer <jwt-token>`

Returns basic user information from JWT token (no database lookup required).

Response:
```json
{
  "user": {
    "id": "user-uuid",
    "email": "user@example.com",
    "name": "user",
    "avatarUrl": null,
    "bio": null
  }
}
```

Example curl:
```bash
curl -X GET http://localhost:7130/api/auth/me \
  -H "Authorization: Bearer <jwt-token>"
```


## Error Response Format

All error responses follow this format:
```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable error message",
  "statusCode": 400,
  "nextActions": "Suggested action to resolve the error"
}
```

Example error:
```json
{
  "error": "INVALID_CREDENTIALS",
  "message": "Invalid email or password",
  "statusCode": 401,
  "nextActions": "Please check your credentials and try again"
}
```

## OAuth Support

Insforge supports Google and GitHub OAuth when configured with environment variables.

OAuth workflow:
1. End user clicks the OAuth login button and redirects to Google/GitHub platform (redirect link obtained from InsForge backend);
2. After successful user authorization, Google/GitHub redirects to InsForge backend;
3. InsForge backend generates JWT access token and other authentication info, then redirects to the application page;

Prerequisites:
1. Create Google or GitHub OAuth Application, fill in appropriate information, and obtain Client ID and Client Secret;
2. Configure each platform's Client ID/Client Secret in InsForge backend(via Environment Variables or dashboard);

### OAuth Endpoints
#### Get Google platform authentication link:
**GET** `/api/auth/v1/google-auth?redirectUrl=your_application_endpoint`

`redirectUrl` is MUST provided by the application.

Response:
```json
{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?client_id={your_client_id}&redirect_uri=hfa&scope=user%3Aemail&state=eyJ9",
  "message": "Redirect the user to the authUrl for Google authentication",
  "nextActions": "After authentication, user will be redirected back with auth code"
}
```

Example curl:
```bash
curl -X GET "http://localhost:7130/api/auth/v1/google-auth?redirectUrl=http://localhost:3000/callback"
```

#### Get GitHub platform authentication link:
**GET** `/api/auth/v1/github-auth?redirectUrl=your_application_endpoint`

`redirectUrl` is MUST provided by the application.

Response:
```json
{
  "authUrl": "https://github.com/login/oauth/authorize?client_id={your_client_id}&redirect_uri=hfa&scope=user%3Aemail&state=eyJ9",
  "message": "Redirect the user to the authUrl for GitHub authentication",
  "nextActions": "After authentication, user will be redirected back with auth code"
}
```

Example curl:
```bash
curl -X GET "http://localhost:7130/api/auth/v1/github-auth?redirectUrl=http://localhost:3000/callback"
```

#### OAuth Result callback:
**GET** `redirectUrl?accessToken={jwt-token}&userId={current_user_id}&email={current_user_email}&name={current_user_name}`

The user login result will callback to the redirectUrl with authentication information.
Similar to the login endpoint (`/api/auth/login`), the application frontend should persist this JWT accessToken to local storage and include it in subsequent requests (`Authorization` Header)

## Built-in Auth Tables

System-managed tables (use Auth API, not database API):
- **_auth** - User credentials
- **_identities** - OAuth logins  
- **_profiles** - User profile data

## API Key Management

API keys are managed through the admin dashboard. Each project has one API key that provides full database access.

## Important Notes

1. JWT access tokens expire - handle token refresh in your application
2. API keys don't expire but can be regenerated
3. Admin user is created on first run (check logs for credentials)
4. OAuth requires GOOGLE_CLIENT_ID/SECRET or GITHUB_CLIENT_ID/SECRET env vars