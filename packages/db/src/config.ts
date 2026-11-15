export type DatabaseConfig = {
  DATABASE_URL: string;
  /** Maximum client connections in this process. Serverless instances use 1. */
  poolMax?: number;
};
