import { Pool, type PoolClient } from "pg";

export interface JobLocks {
  /** Runs fn only when this process wins the advisory lock for the key. */
  run<T>(key: number, fn: () => Promise<T>): Promise<T | undefined>;
  close(): Promise<void>;
}

/**
 * Postgres advisory locks for recurring jobs. The lock lives on one pooled
 * connection for the duration of the job, so a process that dies releases it
 * when the connection closes. Other replicas see the lock and skip the tick.
 */
const UNAVAILABLE_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "08003",
  "08006",
  "57P01",
]);

/**
 * A database that is simply not running should not produce a stack trace from
 * every scheduled tick. Requests will surface the outage where a caller can
 * act on it; a background sweep can wait for the next tick.
 */
export function isDatabaseUnavailable(error: unknown): boolean {
  const record = error as { code?: unknown; errors?: unknown };
  const codes = new Set<string>();
  if (typeof record?.code === "string") codes.add(record.code);
  if (Array.isArray(record?.errors)) {
    for (const inner of record.errors) {
      const code = (inner as { code?: unknown }).code;
      if (typeof code === "string") codes.add(code);
    }
  }
  return [...codes].some((code) => UNAVAILABLE_CODES.has(code));
}

export function createJobLocks(connectionString: string): JobLocks {
  const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5_000 });
  // Idle clients can fail while the database restarts; the next tick reconnects.
  pool.on("error", () => undefined);

  return {
    async run<T>(key: number, fn: () => Promise<T>): Promise<T | undefined> {
      let client: PoolClient;
      try {
        client = await pool.connect();
      } catch (error) {
        if (isDatabaseUnavailable(error)) return undefined;
        throw error;
      }
      try {
        const result = await client.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock($1::bigint) AS locked",
          [key],
        );
        if (!result.rows[0]?.locked) return undefined;
        try {
          return await fn();
        } finally {
          await client.query("SELECT pg_advisory_unlock($1::bigint)", [key]);
        }
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
