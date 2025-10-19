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
ARG VITE_API_BASE_URL
ARG VITE_ADMIN_EMAIL
ARG VITE_ADMIN_PASSWORD

# Set environment variables for the build
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_ADMIN_EMAIL=$VITE_ADMIN_EMAIL
ENV VITE_ADMIN_PASSWORD=$VITE_ADMIN_PASSWORD

# Build frontend with environment variables baked in
RUN npm run build

# Expose ports
EXPOSE 7130 7131

# Run migrations and start the backend application
CMD sh -c "cd backend && npm run migrate:up && cd .. && npm start"
