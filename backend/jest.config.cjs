/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  
  moduleNameMapper: {
    // IMPORTANT: Order matters! More specific patterns first
    // Handle .js extensions in imports (strip them and resolve to actual .ts files)
    '^@/(.*)\\.js$': '<rootDir>/src/$1',
    // Handle imports without .js extension
    '^@/(.*)$': '<rootDir>/src/$1',
    // Map the shared-schemas package to its actual location
    '^@insforge/shared-schemas$': '<rootDir>/../shared-schemas/src/index.ts',
  },
  
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  
  // Configure ts-jest to handle TypeScript properly
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        // Override tsconfig for Jest to use CommonJS
        module: 'commonjs',
        target: 'ES2022',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        resolveJsonModule: true,
        // Ensure paths are resolved correctly
        baseUrl: '.',
        paths: {
          '@/*': ['./src/*'],
          '@insforge/shared-schemas': ['../shared-schemas/src/index.ts']
        }
      }
    }]
  },
  
  // Optional: uncomment to only run unit tests
  // roots: ['<rootDir>/tests/unit'],
  
  // Handle module resolution
  moduleDirectories: ['node_modules', '<rootDir>'],
};