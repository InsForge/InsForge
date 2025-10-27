FROM node:20-alpine

WORKDIR /app

# Copy only package.json files (not lock files) to avoid platform issues
COPY package.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY shared-schemas/package.json ./shared-schemas/

# Install all dependencies - will generate Linux-compatible lock file
RUN npm install && npm cache clean --force && rm -rf /tmp/*

# Copy source code
COPY . .

# Build arguments for Vite environment variables
# These must be defined as ARG because Vite replaces import.meta.env.VITE_* at build time
ARG VITE_API_BASE_URL
ARG VITE_PUBLIC_POSTHOG_KEY

# Build frontend with environment variables baked in
RUN npm run build

# Expose ports
EXPOSE 7130 7131

# Run migrations and start the backend application
CMD sh -c "cd backend && npm run migrate:up && cd .. && npm start"
