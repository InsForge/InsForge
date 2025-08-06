# Insforge Dashboard

A React-based admin dashboard for managing Insforge projects and databases.

## Features

- **Dashboard Overview**: System statistics and project overview
- **Project Management**: Create, view, and delete projects
- **Database Viewer**: Browse tables, schemas, and data
- **API Key Management**: Copy and manage project API keys
- **User Authentication**: Secure admin login

## Development

```bash
# Install dependencies
npm install

# Start development server (runs on port 7131)
npm run dev

# Build for production
npm run build
```

## Built With

- **React 18** - UI Framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Vite** - Build tool
- **React Router** - Navigation
- **Lucide React** - Icons

## API Integration

The dashboard communicates with the Insforge backend via REST API:

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login (email/password)
- `GET /api/auth/me` - Get current user info
- `GET /api/auth/users` - List all users (admin only)

### Database Management
- `GET /api/database/tables` - List all tables
- `POST /api/database/tables` - Create new table with schema
- `DELETE /api/database/tables/:tablename` - Delete table
- `GET /api/database/tables/:tablename/schema` - Get table schema
- `PATCH /api/database/tables/:tablename/schema` - Modify table schema

### Record Operations
- `GET /api/database/records/:tablename` - Query records (supports pagination)
- `POST /api/database/records/:tablename` - Insert records
- `PATCH /api/database/records/:tablename?id=eq.:id` - Update specific record
- `DELETE /api/database/records/:tablename?id=eq.:id` - Delete specific record

### Storage
- `GET /api/storage/buckets` - List all buckets
- `POST /api/storage/buckets` - Create new bucket
- `PATCH /api/storage/buckets/:bucketName` - Update bucket
- `DELETE /api/storage/buckets/:bucketName` - Delete bucket
- `GET /api/storage/buckets/:bucketName/objects` - List objects in bucket
- `PUT /api/storage/buckets/:bucketName/objects/:objectKey` - Upload object with specific key
- `POST /api/storage/buckets/:bucketName/objects` - Upload object with auto-generated key
- `GET /api/storage/buckets/:bucketName/objects/:objectKey` - Download object
- `DELETE /api/storage/buckets/:bucketName/objects/:objectKey` - Delete object

### Metadata & Logs
- `GET /api/metadata` - Get system metadata and statistics
- `GET /api/logs` - Get activity logs (admin only)

## Project Structure

```
frontend/
├── src/
│   ├── components/        # Reusable UI components
│   │   ├── layout/       # Layout components
│   │   └── table/        # Table components
│   ├── features/         # Feature modules
│   │   ├── auth/         # Authentication (login, users)
│   │   ├── dashboard/    # Dashboard & metadata
│   │   ├── database/     # Database management
│   │   ├── logs/         # Activity logs
│   │   └── storage/      # File storage
│   ├── lib/              # Utilities and API client
│   │   └── api/          # API client configuration
│   ├── types/            # TypeScript type definitions
│   ├── App.tsx           # Main app component
│   └── main.tsx          # Entry point
├── public/               # Static assets
├── index.html            # HTML template
├── vite.config.ts        # Vite configuration
└── package.json          # Dependencies
```

## Usage

1. Start the Insforge backend server
2. Navigate to `http://localhost:7130` in your browser (production) or `http://localhost:7131` (development)
3. Login with your admin credentials (from .env file)
4. Create tables and manage data

### Key Features
- **Table Management**: Create tables with explicit schemas defining column types
- **Data Types**: Support for string, integer, float, boolean, datetime, json, uuid, and file types
- **Auto-generated Fields**: Every table gets id, created_at, and updated_at fields
- **Record Management**: Full CRUD operations with pagination support
- **API Key**: Single API key for all database operations (displayed in dashboard)

The dashboard is automatically served by the backend when you access the root URL.