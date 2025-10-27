# InsForge SDK Documentation

## What Insforge OSS Does

Backend-as-a-service with database, authentication, file storage, out of box AI abilities

**Key Concept**: InsForge replaces your traditional backend - implement business logic by calling database operations directly. Instead of building API endpoints, use our database API as your application's backend.

## Critical Rule: Check Metadata First

Before ANY operation, call `get-backend-metadata` to get the current backend state. 

## When to Use SDK vs MCP Tools

### Use SDK for:
- Authentication (register, login, logout)
- Database CRUD operations (select, insert, update, delete)
- User profile management
- AI operations (chat completions, image generation)
- Storage operations (upload, download, list files)
- Application logic

### Use MCP Tools for:
- Getting started & documentation (`get-instructions`)
- Database operations (`run-raw-sql` for CREATE/ALTER/DROP tables, `get-table-schema` for inspection)
- Backend metadata (`get-backend-metadata`)
- Storage bucket creation (`create-bucket`, `list-buckets`, `delete-bucket`)
- Edge Functions Creation and Upload (`create-function`, `get-function`, a`update-function`, `delete-function`)
  - **Important**: Edge functions should only be used for backend API services
  - **CRITICAL**: Edge functions do NOT support subpaths - single endpoint only per function
  - ❌ **Will NOT work**: `/functions/my-api/users`, `/functions/my-api/posts/123`, `/functions/my-api/admin/stats`
  - ✅ **Will work**: `/functions/my-api` with `{ "action": "getUsers" }`, `/functions/my-api` with `{ "action": "getPost", "id": 123 }`
  - Use request method + body to route: `GET /functions/task-api?action=list`, `POST /functions/task-api {"action": "create", "title": "New"}`

### Edge Functions Pattern

**Create secure edge functions using Insforge SDK:**

```javascript
// No import needed - createClient is injected by the worker template
module.exports = async function(request) {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  // Handle OPTIONS
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Extract token from request headers
  const authHeader = request.headers.get('Authorization');
  const userToken = authHeader ? authHeader.replace('Bearer ', '') : null;
  
  // Create client with the edge function token
  // Use BACKEND_INTERNAL_URL environment variable for internal Docker communication
  const client = createClient({ 
    baseUrl: Deno.env.get('BACKEND_INTERNAL_URL') || 'http://insforge:7130',
    edgeFunctionToken: userToken
  });
  
  // Example: Get authenticated user for database operations
  const { data: userData } = await client.auth.getCurrentUser();
  if (userData?.user?.id) {
    // Use userData.user.id for foreign key constraints
    await client.database.from('table').insert([{ user_id: userData.user.id }]);
  }
}
```

## Setup

```bash
npm install @insforge/sdk@latest
```

```javascript
import { createClient } from '@insforge/sdk';
const client = createClient({ baseUrl: 'http://localhost:7130' });
```

## Authentication

```javascript
// Sign Up
const { data, error } = await client.auth.signUp({
  email: 'user@example.com',
  password: 'password123'
});
// Returns: { user: {...}, accessToken: 'jwt...' }
// Backend auto-creates user profile in 'users' table

// Sign In
const { data, error } = await client.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password123'
});
// Token stored automatically for all requests

// Sign In with OAuth
const { data, error } = await client.auth.signInWithOAuth({ 
  provider: 'google'|'github', 
  redirectTo: window.location.origin,
  skipBrowserRedirect: true
})
// Returns: { data: { url, provider }, error }

// Manual redirect required
if (data?.url) {
  window.location.href = data.url
}

// ⚠️ IMPORTANT: No callback handling needed!
// After OAuth, user returns to redirectTo URL already authenticated
// The SDK automatically:
// - Handles the OAuth callback
// - Stores the JWT token
// - Makes user available via getCurrentUser()

// ❌ DON'T DO THIS (not needed):
// const accessToken = urlParams.get('access_token')
// const userId = urlParams.get('user_id')

// ✅ DO THIS INSTEAD (after redirect back):
const { data, error } = await client.auth.getCurrentUser()

// Get Current User (with profile)
const { data, error } = await client.auth.getCurrentUser();
// Returns: { 
//   user: {id, email, role},      // Auth data
//   profile: {id, nickname, ...}  // Users table data (object, not array!)
// }

// Update Profile
const { data, error } = await client.auth.setProfile({
  nickname: 'John',
  bio: 'Developer',
  avatar_url: 'https://...'
});
// Returns: {id, nickname, bio, ...}  // Single object, not array!

// Get Any User's Profile
const { data, error } = await client.auth.getProfile(userId);
// Returns: {id, nickname, bio, ...}  // Single object, not array!

// Get Session (local storage only, no API call)
const { data } = await client.auth.getCurrentSession();
// Returns: { session: { accessToken: 'jwt...', user: {...} } }

// Sign Out
await client.auth.signOut();
```

## Database Operations

Before ANY operation, call `get-backend-metadata` to get the current backend state. 

```javascript
// Select with filters
const { data, error } = await client.database
  .from('posts')
  .select('*, users!inner(*)')
  .eq('user_id', userId)
  .order('created_at', { ascending: false })
  .limit(10);

// Insert (array required, but use .single() for one record)
const { data, error } = await client.database
  .from('posts')
  .insert([{ 
    title: 'My Post', 
    user_id: userId,
    image_url: 'https://...'
  }])
  .select()
  .single();  // Returns single object!

// Update (returns single object with .single())
const { data, error } = await client.database
  .from('users')
  .update({ nickname: 'John', bio: 'Developer' })
  .eq('id', userId)
  .select()
  .single();  // Returns single object!

// Delete
const { data, error } = await client.database
  .from('posts')
  .delete()
  .eq('id', postId);
```

## Edge Functions Invocation

Invoke deployed edge functions from the SDK (similar to Supabase):

```javascript
// Basic invocation with JSON body (POST by default)
const { data, error } = await client.functions.invoke('hello-world', {
  body: { name: 'World' }
});

// GET request (no body)
const { data, error } = await client.functions.invoke('my-function', {
  method: 'GET'
});

// With custom headers
const { data, error } = await client.functions.invoke('my-function', {
  body: { action: 'create', item: 'task' },
  headers: { 'x-custom-header': 'value' }
});

// Different HTTP methods
const { data, error } = await client.functions.invoke('api-endpoint', {
  method: 'PUT',
  body: { id: '123', status: 'active' }
});

// Error handling
if (error) {
  console.error('Function error:', error.message);
} else {
  console.log('Success:', data);
}
```

## Storage Operations

Before ANY operation, call `get-backend-metadata` to get the current backend state.

```javascript
// 1. Upload file
const { data, error } = await client.storage
  .from('images')
  .upload('profile.jpg', fileObject);

if (error) return;

// 2. Response includes url and key
// {
//   url: "http://localhost:7130/api/storage/buckets/images/objects/profile%20(1).jpg",
//   key: "profile (1).jpg"  // May differ from requested name if conflict!
// }

// 3. Store URL in database
await client.database
  .from('posts')
  .insert([{
    user_id: userId,
    image_url: data.url  // ✅ Always use returned URL
  }])
  .select()
  .single();

// 4. Display image
<img src={post.image_url} alt="Post" />

// Optional: If you need programmatic download, store the key too
await client.database
  .from('posts')
  .insert([{
    user_id: userId,
    image_url: data.url,  // For display
    image_key: data.key   // For download
  }]);

// Then download file as blob
const { data: blob } = await client.storage.from('images').download(post.image_key);

```

## AI Operations

Before ANY operation, call `get-backend-metadata` to get the current backend state. 

### Chat Completions (OpenAI-compatible response)

```javascript
// Non-streaming chat completion (OpenAI-compatible response)
const completion = await client.ai.chat.completions.create({
  model: 'openai/gpt-4o',
  messages: [
    { 
      role: 'system', 
      content: 'You are a helpful assistant' 
    },
    { 
      role: 'user', 
      content: 'What is the capital of France?',
      images: [  // Optional: attach images for vision models
        { url: 'https://example.com/image.jpg' },
        { url: 'data:image/jpeg;base64,...' }  // Base64 also supported
      ]
    }
  ],
  temperature: 0.7,      // Optional: 0-2
  maxTokens: 1000,       // Optional: max completion tokens
  topP: 0.9,            // Optional: 0-1
  stream: false         // Optional: enable streaming
});

// Access response - OpenAI format
console.log(completion.choices[0].message.content);  // "The capital of France is Paris"
console.log(completion.usage.total_tokens);          // Token usage
```

### Image + Chat Completions Generation

```javascript
// Image + chat completion generation request
// This model can generate images AND provide text responses 
const response = await client.ai.images.generate({
  model: 'google/gemini-2.5-flash-image-preview',
  prompt: 'A serene landscape with mountains at sunset',
  images: [  // Optional: input images for image-to-image models
    { url: 'https://example.com/reference.jpg' }
  ]
});

// Access response - OpenAI format
console.log(response.data[0].b64_json);  // Base64 encoded image string (OpenAI format)
console.log(response.data[0].content);   // AI's text response about the image or prompt

const base64Image = response.data[0].b64_json;
const buffer = Buffer.from(base64Image, 'base64');
const blob = new Blob([buffer], { type: 'image/png' });

// Upload to Insforge storage
const fileName = `image-${Date.now()}.png`;
const { data: uploadData, error: uploadError } = await client.storage
  .from('chat-images')
  .upload(fileName, blob);
```

## Complete Example

```javascript
import { createClient } from '@insforge/sdk';

const client = new createClient({ baseUrl: 'http://localhost:7130' });

// 1. Sign up new user
const { data: auth, error } = await client.auth.signUp({
  email: 'user@example.com',
  password: 'password123'
});

// 2. Update profile (returns object, not array!)
const { data: profile } = await client.auth.setProfile({
  nickname: 'JohnDoe',
  bio: 'Full-stack developer'
});
console.log(profile.nickname); // 'JohnDoe' - direct access!

// 3. Get current user with profile
const { data: userData } = await client.auth.getCurrentUser();
console.log(userData.user.email);        // 'user@example.com'
console.log(userData.profile.nickname);  // 'JohnDoe'

// 4. Create a post
const { data: post } = await client.database
  .from('posts')
  .insert([{
    user_id: userData.user.id,
    caption: 'Hello World',
    image_url: 'https://example.com/image.jpg'
  }])
  .select()
  .single();  // Returns single object!

// 5. Get another user's profile (returns object!)
const { data: otherUser } = await client.auth.getProfile('other-user-id');
console.log(otherUser.nickname); // Direct access to properties
```

## Key Points

### Edge Functions
- **SDK Availability**: `createClient` is globally available - no import needed
- **Token Handling**: Extract from `Authorization` header, use as `edgeFunctionToken` parameter
- **Flexible Auth**: Can use user token or anon token (from `ACCESS_API_KEY` env var)
- **Backend Validation**: Tokens are validated by backend on each SDK request
- **Internal Networking**: Use `BACKEND_INTERNAL_URL` environment variable (defaults to `http://insforge:7130` for Docker container communication)

### Edge Functions Invocation (SDK)
- **Simple API**: `client.functions.invoke(slug, options)`
- **Auto-authentication**: SDK automatically includes auth token from logged-in user
- **Flexible body**: Accepts any JSON-serializable data
- **HTTP methods**: Supports GET, POST, PUT, PATCH, DELETE (default: POST)
- **Returns**: `{ data, error }` structure consistent with other SDK methods

### AI Operations - OpenAI Compatibility
- **Request Format**: Consistent structure across chat and image generation
  - `model`: Model identifier (provider/model-name format)
  - `messages` for chat, `prompt` for images
  - Optional `images` array for multimodal inputs
- **Response Format**: AI module returns OpenAI-compatible response structures for Chat Completion
- **Multimodal Support**: Both endpoints accept image inputs via `images` array
- **Streaming**: Chat completions support streaming with `stream: true`

### Profile Management
- **Auto-creation**: When users sign up/sign in, backend automatically creates a record in `users` table
- **Profile methods return objects**: `setProfile()` and `getProfile()` return single objects, not arrays!
- **Two data sources**: 
  - `user` = auth data (id, email, role)
  - `profile` = users table data (id, nickname, avatar_url, bio, etc.)

### SDK Behavior
- Tokens stored and managed automatically after login
- All operations return `{data, error}` structure
- Database insert requires array format: `[{...}]` even for single records
- Use `.single()` to get object instead of array from queries
- Raw SQL is NOT available in SDK 

### When to Use What
- **SDK**: Authentication, database CRUD, profile management, AI operations, storage
- **MCP Tools**: Table creation/modification, schema management

### Storage Best Practices
- **ALWAYS use Storage for**:
  - Images (URLs, base64, binary data)
  - Files and documents
  - Large text content (>1KB)
  - AI-generated images
  - Chat message attachments
- **Store in Database**:
  - Storage URLs only (not the actual data)
  - Small text fields (less than 1KB)
  - Metadata and references
- **Example**: For chat with images, store image in storage bucket, save only the URL in database