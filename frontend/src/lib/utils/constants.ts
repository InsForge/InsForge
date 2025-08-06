// UI constants
export const BREAKPOINTS = {
  xs: 475,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

// Colors for stat cards
export const STAT_COLORS = {
  blue: {
    icon: 'text-blue-400',
    bg: 'bg-blue-500/10',
  },
  green: {
    icon: 'text-green-400',
    bg: 'bg-green-500/10',
  },
  purple: {
    icon: 'text-purple-400',
    bg: 'bg-purple-500/10',
  },
  emerald: {
    icon: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
  },
  yellow: {
    icon: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
  },
} as const;

// Storage keys
export enum StorageKeys {
  AUTH_TOKEN = 'auth_token',
  USER_PREFERENCES = 'user_preferences',
}
