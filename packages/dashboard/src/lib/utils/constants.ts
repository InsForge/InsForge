export const BREAKPOINTS = {
  xs: 475,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

export const LOCAL_STORAGE_KEYS = {
  theme: 'insforge-theme',
  selectedLogSource: 'selectedLogSource',
  sqlEditorTabs: 'sql-editor-tabs',
  sqlEditorActiveTab: 'sql-editor-active-tab',
  databaseTablePreferences: 'insforge.database.tables.preferences.v1',
} as const;

export const LOCAL_STORAGE_KEY_PREFIXES = {
  pageSize: 'insforge-page-size',
} as const;
