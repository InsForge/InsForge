FROM node:20-alpine

WORKDIR /app

# Copy root package files for workspaces
COPY package*.json ./

# Copy backend, frontend, and shared-schemas package files
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
COPY shared-schemas/package*.json ./shared-schemas/

# Install all dependencies (workspaces will handle both backend and frontend)
RUN npm ci --production=false

# Copy source code
COPY . .

# Build the application (both backend and frontend)
RUN npm run build

# Expose ports
EXPOSE 7130 7131

# Start the backend application
CMD ["npm", "start"]