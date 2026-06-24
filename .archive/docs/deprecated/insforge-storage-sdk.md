# InsForge Storage SDK

## Setup
```javascript
import { createClient } from '@insforge/sdk';
const client = createClient({ baseUrl: 'http://localhost:7130' });
```

## Bucket Operations

### from(bucketName)
```javascript
const bucket = client.storage.from('avatars')  // Returns StorageBucket instance
```

## File Operations

### upload
```javascript
// Upload with specific key
const { data, error } = await client.storage
  .from('avatars')
  .upload('user-123.jpg', file);

// data: StorageFileSchema { bucket, key, size, mimeType, uploadedAt, url }
```

### uploadAuto
```javascript
// Upload with auto-generated key
const { data, error } = await client.storage
  .from('avatars')
  .uploadAuto(file);

// Generated key format: filename-timestamp-random.ext
```

### download
```javascript
const { data: blob, error } = await client.storage
  .from('avatars')
  .download('user-123.jpg');

// data: Blob (can convert to URL with URL.createObjectURL(blob))
```

### remove
```javascript
const { data, error } = await client.storage
  .from('avatars')
  .remove('user-123.jpg');
```

### list
```javascript
const { data, error } = await client.storage
  .from('avatars')
  .list({
    prefix: 'users/',     // Filter by prefix
    search: 'profile',    // Search in filenames
    limit: 10,           // Max results (default: 100)
    offset: 0            // Skip results
  });

// data: ListObjectsResponseSchema { bucketName, objects[], pagination }
```

### getPublicUrl
```javascript
// Get public URL (no API call)
const url = client.storage
  .from('avatars')
  .getPublicUrl('user-123.jpg');

// Returns: http://localhost:7130/api/storage/buckets/avatars/objects/user-123.jpg
```

## File Upload Examples

### Upload File from Input
```javascript
// HTML: <input type="file" id="fileInput">
const fileInput = document.getElementById('fileInput');
const file = fileInput.files[0];

const { data, error } = await client.storage
  .from('uploads')
  .upload(`photos/${file.name}`, file);
```

### Upload Blob
```javascript
const blob = new Blob(['Hello World'], { type: 'text/plain' });

const { data, error } = await client.storage
  .from('documents')
  .upload('hello.txt', blob);
```

### Upload with Custom Name
```javascript
// Simple file upload - SDK handles FormData creation
const file = fileInput.files[0];

const { data, error } = await client.storage
  .from('uploads')
  .upload('custom-name.jpg', file);
```

## Download & Display

### Download and Display Image
```javascript
const { data: blob, error } = await client.storage
  .from('avatars')
  .download('user-123.jpg');

if (blob) {
  const url = URL.createObjectURL(blob);
  document.getElementById('avatar').src = url;
  
  // Clean up
  URL.revokeObjectURL(url);
}
```

### Direct URL for Public Buckets
```javascript
// For public buckets, use direct URL
const url = client.storage
  .from('public-avatars')
  .getPublicUrl('user-123.jpg');

document.getElementById('avatar').src = url;
```

## Error Handling
```javascript
const { data, error } = await client.storage
  .from('avatars')
  .upload('user-123.jpg', file);

if (error) {
  if (error.statusCode === 409) {
    console.error('File already exists');
  } else if (error.statusCode === 404) {
    console.error('Bucket not found');
  } else {
    console.error(error.message);
  }
}
```

## Notes
- Bucket creation/deletion handled via MCP tools, not SDK
- Public buckets allow unauthenticated downloads
- Private buckets require authentication for all operations
- File keys can include paths (e.g., 'folder/subfolder/file.jpg')
- Use `uploadAuto()` to prevent filename conflicts