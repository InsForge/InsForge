# Better Auth Tested Endpoints - Real Examples

**Note**: Better Auth endpoints do NOT require the `x-api-key` header. They handle their own authentication.

## 1. Admin Login

```bash
curl -X POST http://localhost:7130/api/auth/v2/admin/sign-in \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"change-this-password"}'
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "1754244268102-4hmusc2mj",
    "email": "admin@example.com",
    "name": "Administrator",
    "role": "project_admin"
  }
}
```

## 2. Get Current User

```bash
curl http://localhost:7130/api/auth/v2/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**
```json
{
  "user": {
    "id": "1754244268102-4hmusc2mj",
    "email": "admin@example.com",
    "type": "admin",
    "role": "project_admin"
  }
}
```

## 3. List Users

```bash
curl "http://localhost:7130/api/auth/v2/admin/users?limit=3&offset=0" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**
```json
{
  "users": [
    {
      "id": "TvbztBVdkj1cHNkgZCKRyZl2err8qpPh",
      "email": "newuser@example.com",
      "name": "New User",
      "identities": [],
      "provider_type": "Email",
      "created_at": "2025-08-03T20:51:57.332Z",
      "updated_at": "2025-08-03T20:51:57.332Z"
    }
  ],
  "total": 3
}
```

## 4. Get Single User

```bash
curl "http://localhost:7130/api/auth/v2/admin/users/TvbztBVdkj1cHNkgZCKRyZl2err8qpPh" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"(ADMIN)
```

**Response:**
```json
{
  "id": "TvbztBVdkj1cHNkgZCKRyZl2err8qpPh",
  "email": "newuser@example.com",
  "name": "New User",
  "emailVerified": false,
  "createdAt": "2025-08-03T20:51:57.332Z",
  "updatedAt": "2025-08-03T20:51:57.332Z"
}
```

## 5. OAuth Login (Google/GitHub)

```bash
curl -X POST http://localhost:7130/api/auth/v2/sign-in/social \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "google",                                    # Required: "google" or "github"
    "callbackURL": "http://localhost:7130/dashboard",       # Required: Where to redirect after success
    "errorCallbackURL": "http://localhost:7130/login",      # Optional: Where to redirect on error
    "newUserCallbackURL": "http://localhost:7130/welcome",  # Optional: Where to redirect new users
    "disableRedirect": true                                  # Optional: Return URL instead of redirecting
  }'
```

**Request Body Fields:**
- `provider` (required): OAuth provider - "google" or "github"
- `callbackURL` (required): Full URL where user goes after successful login
- `errorCallbackURL` (optional): Full URL where user goes if OAuth fails
- `newUserCallbackURL` (optional): Full URL where NEW users go after first sign-up
- `disableRedirect` (optional): 
  - `true`: Returns the OAuth URL in response (for custom handling)
  - `false`/omitted: Automatically redirects to the OAuth provider

**Response (when disableRedirect: true):**
```json
{
  "url": "https://accounts.google.com/o/oauth2/auth?client_id=994294506382...&redirect_uri=http://localhost:7130/api/auth/v2/callback/google...",
  "redirect": false
}
```

**OAuth Flow:**
1. Your app calls `/sign-in/social`
2. User redirected to Google/GitHub login
3. User authorizes your app
4. Provider redirects to `/api/auth/v2/callback/{provider}`
5. Better Auth processes and redirects to your `callbackURL`

**Important Notes:**
- All URLs must be absolute (start with http:// or https://)
- The OAuth redirect_uri is automatically set to `/api/auth/v2/callback/{provider}`
- You must configure the exact redirect_uri in your OAuth provider settings

**Working Example (Google):**
```bash
# Get OAuth URL
curl -X POST http://localhost:7130/api/auth/v2/sign-in/social \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "google",
    "callbackURL": "http://localhost:7130/dashboard",
    "disableRedirect": true
  }'

# Response contains the Google OAuth URL
# Open this URL in browser to complete the flow
```

## 6. User Registration

```bash
curl -X POST http://localhost:7130/api/auth/v2/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"newuser@example.com","password":"password123","name":"New User"}'
```

**Response:**
```json
{
  "token": "eMqIAd9LpHGb8RZ6RPAs4lYqQ9bgznBQ",  // Session token (not JWT)
  "user": {
    "id": "rY0gVcPLsu2068AaSqmcl10bx4I30ZKn",
    "email": "newuser@example.com",
    "name": "New User",
    "image": null,
    "emailVerified": false,
    "createdAt": "2025-08-03T22:55:32.268Z",
    "updatedAt": "2025-08-03T22:55:32.268Z"
  }
}
```

## 7. User Login

```bash
curl -X POST http://localhost:7130/api/auth/v2/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"newuser@example.com","password":"password123"}'
```

**Response:**
```json
{
  "redirect": false,
  "token": "JV7nDZjxt7zBlzwbK8Ii95Xp4shsi22y",  // Session token (not JWT)
  "user": {
    "id": "rY0gVcPLsu2068AaSqmcl10bx4I30ZKn",
    "email": "newuser@example.com",
    "name": "New User",
    "image": null,
    "emailVerified": false,
    "createdAt": "2025-08-03T22:55:32.268Z",
    "updatedAt": "2025-08-03T22:55:32.268Z"
  }
}
```

## 8. Bulk Delete Users

```bash
curl -X DELETE http://localhost:7130/api/auth/v2/admin/users/bulk-delete \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userIds":["user-id-1","user-id-2"]}'
```

**Response:**
```json
{
  "deletedCount": 0
}
```

## Important Notes

### Token Types
- **Admin Login**: Returns JWT token (`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`)
- **User Registration/Login**: Returns session token (`JV7nDZjxt7zBlzwbK8Ii95Xp4shsi22y`)
- Both token types work with the `/me` endpoint

### Key Differences
1. **No API Key Required**: Better Auth endpoints don't need `x-api-key` header
2. **Admin vs User**: Admins get JWT tokens, regular users get session tokens
3. **Token Expiry**: JWT tokens expire in 7 days, session tokens have their own lifecycle
4. **OAuth**: Only works if OAuth providers are configured in environment variables