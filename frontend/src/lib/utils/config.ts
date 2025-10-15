/**
 * Configuration utility functions for the frontend application
 */

/**
 * Get the API base URL from environment variable or determine from current location
 * @returns The API base URL to use for backend requests
 */
export function getApiBaseUrl(): string {
    // Check for Vite environment variable first
    if (import.meta.env.VITE_API_BASE_URL) {
      return import.meta.env.VITE_API_BASE_URL;
    }
  
    // In production (HTTPS), use the same origin
    if (window.location.protocol === 'https:') {
      return window.location.origin;
    }
  
    // Local development with HTTP - use default backend port
    return 'http://localhost:7130';
  }
  
  /**
   * Check if the current deployment is on InsForge Cloud
   * @returns true if running on *.insforge.app domain
   */
  export function isInsForgeCloudProject(): boolean {
    return window.location.hostname.endsWith('.insforge.app');
  }
  
  