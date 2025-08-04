# Project Overview

InsForge is an open-source Backend-as-a-Service (BaaS) platform designed specifically for AI agents. It provides a comprehensive solution for managing backend services including authentication, database operations, storage, and serverless functions, all accessible through REST APIs with PostgreSQL as the primary database.

## Architecture

This is a monorepo containing:
- **Backend**: Node.js with Express.js, providing RESTful APIs
- **Frontend**: React with Vite, offering an admin dashboard
- **Functions**: Serverless function runtime using Deno
- **Shared-schemas**: Common TypeScript schemas shared across modules

## Folder Structure

- `/backend`: Node.js backend server
  - `/src/api`: API routes and middleware
  - `/src/controllers`: Business logic controllers
  - `/src/core`: Core services (auth, database, storage, metadata)
  - `/src/types`: TypeScript type definitions
  - `/src/utils`: Utility functions and helpers
- `/frontend`: React dashboard application
  - `/src/components`: Reusable UI components
  - `/src/features`: Feature-specific modules (auth, database, storage, logs)
  - `/src/lib`: Shared libraries, hooks, and utilities
- `/functions`: Serverless function runtime
- `/shared-schemas`: Shared TypeScript schemas
- `/docker-init`: Docker initialization scripts
- `/openapi`: API documentation in OpenAPI format
- `/tests`: Comprehensive test suites

## Libraries and Frameworks

### Backend
- Express.js for REST API framework
- PostgreSQL with pg driver for database
- Better-auth for authentication
- AWS SDK for S3-compatible storage
- Zod for schema validation
- JWT for token management
- TypeScript for type safety

### Frontend
- React 19 with functional components
- Vite for build tooling
- TanStack Query for data fetching
- React Hook Form with Zod validation
- Tailwind CSS for styling
- Radix UI for accessible component primitives
- React Router for navigation
- TypeScript for type safety

## Coding Standards

### General
- Use TypeScript for all code files
- Prefer descriptive, unabbreviated variable and function names
- Follow consistent file naming: kebab-case for files, PascalCase for components
- Maintain clear folder structure with feature-based organization
- Use ES modules (import/export syntax)
- Implement proper error handling with try-catch blocks
- Add appropriate logging for debugging

### Backend Specific
- Use async/await for asynchronous operations
- Implement proper middleware for authentication and error handling
- Follow RESTful conventions for API endpoints
- Use Zod schemas for request/response validation
- Return consistent API responses using utility functions
- Implement proper database transaction handling

### Frontend Specific
- Use functional components with hooks exclusively
- Implement proper TypeScript interfaces for all props
- Use React Hook Form for form handling
- Follow component composition patterns
- Implement proper loading and error states
- Use TanStack Query for server state management
- Keep components focused and single-purpose

### Code Style
- Use single quotes for strings
- Include semicolons at the end of statements
- Use arrow functions for callbacks and inline functions
- Prefer const over let, avoid var
- Use template literals for string interpolation
- Maintain consistent indentation (2 spaces)
- Format code with Prettier configuration

## UI Guidelines

- Follow a clean, modern design with consistent spacing
- Use Radix UI primitives for accessibility
- Maintain consistent color scheme using CSS variables
- Use appropriate loading skeletons for data fetching
- Display clear error messages with actionable feedback
- Implement proper form validation with inline errors
- Use consistent icon set from lucide-react

## Testing Standards

- Implement integration tests for API endpoints
- Maintain test coverage above 70%
- Mock external dependencies appropriately

## Security Considerations

- Never commit secrets or API keys
- Use environment variables for configuration
- Implement proper authentication and authorization
- Validate all user inputs
- Sanitize data before database operations
- Use prepared statements for SQL queries
- Implement rate limiting for API endpoints
- Follow OWASP security best practices

## Performance Guidelines

- Implement proper database indexing
- Use pagination for large data sets
- Optimize React component re-renders
- Implement proper caching strategies
- Use lazy loading for code splitting
- Optimize bundle size with proper imports
- Monitor and log performance metrics

## Documentation

- Document all API endpoints with clear descriptions
- Include JSDoc comments for complex functions
- Maintain up-to-date README files
- Document environment variables and configuration
- Provide clear setup instructions
- Include examples for common use cases