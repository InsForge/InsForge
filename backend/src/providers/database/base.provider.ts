/**
 * Database connection information
 */
export interface DatabaseConnectionInfo {
  connectionURL: string;
  parameters: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    sslmode: string;
  };
}

/**
 * Database password information
 */
export interface DatabasePasswordInfo {
  databasePassword: string;
}

/**
 * Database provider interface
 * Defines the contract for fetching database connection information
 */
export interface DatabaseProvider {
  /**
   * Get database connection string
   * @returns Database connection info with masked password
   */
  getDatabaseConnectionString(): Promise<DatabaseConnectionInfo>;

  /**
   * Get database password
   * @returns Database password (unmasked)
   */
  getDatabasePassword(): Promise<DatabasePasswordInfo>;
}
