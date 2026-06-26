# InsForge Debug SDK

## Common SDK Errors

### Auth Errors
```javascript
// Token not stored
{ code: 'MISSING_AUTHORIZATION_HEADER' }
// Fix: User needs to login

// Token expired
{ code: 'INVALID_TOKEN' }
// Fix: client.auth.signInWithPassword()

// Invalid credentials
{ code: 'INVALID_CREDENTIALS' }
// Fix: Check email/password
```

### Database Errors
```javascript
// Table doesn't exist
{ statusCode: 404, message: 'Table not found' }
// Fix: Use MCP tool to create table

// Missing required field
{ code: '23502', message: 'null value in column "user_id"' }
// Fix: Include all required fields

// Foreign key violation
{ code: '23503', message: 'violates foreign key constraint' }
// Fix: Referenced record must exist

// Permission denied
{ code: '42501', message: 'permission denied for table' }
// Fix: User must be authenticated
```

## Debug Techniques

### 1. Check Authentication
```javascript
const { data, error } = await client.auth.getCurrentUser();
if (error) {
  console.log('Not authenticated:', error.message);
  // Need to login first
}
```

### 2. Verify Token Storage
```javascript
const { data } = await client.auth.getCurrentSession();
console.log('Stored token:', data?.session?.accessToken ? 'Present' : 'Missing');
```

### 3. Test Database Connection
```javascript
// Simple query to test connection
const { error } = await client.database.from('users').select().limit(1);
if (error) {
  console.log('Database issue:', error);
}
```

### 4. Enable Network Inspection
```javascript
// Browser: Open DevTools > Network tab
// Check request headers for Authorization: Bearer token
// Check response for error details
```

### 5. Test With Raw HTTP
```javascript
// When SDK fails, test endpoint directly
const response = await fetch('http://localhost:7130/api/database/records/posts', {
  headers: {
    'Authorization': 'Bearer ' + token
  }
});
const data = await response.json();
console.log('Raw response:', data);
```

## Common Issues

### Empty Response
```javascript
// INSERT/UPDATE/DELETE return empty without Prefer header
// SDK handles this automatically, but check if using raw API
```

### Array Format
```javascript
// POST requires array
// ❌ Wrong: { title: 'Test' }
// ✅ Right: [{ title: 'Test' }]
// SDK handles this automatically
```

### Token Not Persisting
```javascript
// Check storage adapter
const client = createClient({
  baseUrl: 'http://localhost:7130',
});
```

### CORS Issues
```javascript
// Backend allows all origins by default
// If modified, check backend CORS settings
```

## Test Utilities

### Full Test Suite
```javascript
async function testSDK() {
  const email = `test-${Date.now()}@example.com`;
  
  // Test auth
  console.log('Testing auth...');
  const { error: signUpError } = await client.auth.signUp({ email, password: 'test123' });
  if (signUpError) return console.error('SignUp failed:', signUpError);
  
  // Test current user
  const { data: user, error: userError } = await client.auth.getCurrentUser();
  if (userError) return console.error('GetUser failed:', userError);
  console.log('✅ Auth working, user:', user.user.id);
  
  // Test database
  console.log('Testing database...');
  const { data: posts, error: dbError } = await client.database.from('posts').select().limit(1);
  if (dbError) return console.error('Database failed:', dbError);
  console.log('✅ Database working, posts:', posts.length);
  
  // Test insert
  const { error: insertError } = await client.database
    .from('posts')
    .insert({ title: 'Test', user_id: user.user.id })
    .select();
  if (insertError) return console.error('Insert failed:', insertError);
  console.log('✅ Insert working');
}

testSDK().catch(console.error);
```

## Backend Verification

```javascript
// Check backend is running
fetch('http://localhost:7130/api/health')
  .then(r => r.json())
  .then(d => console.log('Backend:', d))
  .catch(e => console.error('Backend not running'));
```