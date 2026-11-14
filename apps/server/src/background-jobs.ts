import type { RateLimiter } from "@notes-learning/api/rate-limit";
import { purgeExpiredTrash } from "@notes-learning/api/services/purge";
import { deliverWebhookBatch } from "@notes-learning/api/services/webhooks";
import {
  createJobLocks,
  isDatabaseUnavailable,
  type Database,
} from "@notes-learning/db";

import { ENV } from "./env.server";

/**
 * Distinct from any other application's advisory locks in the same database.
 * The suffix identifies the job.
 */
const WEBHOOK_LOCK = 0x4c41545401;
const RETENTION_LOCK = 0x4c41545402;

interface Job {
  name: string;
  firstDelayMs: number;
  intervalMs: number;
  /** Present when the job must run on one replica at a time. */
  lock?: number;
  run(): Promise<void>;
}

/**
 * Owns every recurring server task. Database jobs take a Postgres advisory
 * lock so one replica sweeps at a time; the lock releases if the process
 * dies. The rate limiter holds a per-process map, so its sweep runs on every
 * replica by design.
 */
export function startBackgroundJobs(db: Database, rateLimiter: RateLimiter): void {
  const locks = createJobLocks(ENV.DATABASE_URL);
  const jobs: Job[] = [
    {
      name: "webhook delivery",
      firstDelayMs: 10_000,
      intervalMs: 15_000,
      lock: WEBHOOK_LOCK,
      run: async () => {
        const result = await deliverWebhookBatch(db);
        if (result.delivered || result.failed || result.skipped) {
          console.log(
            `Webhooks: ${result.delivered} delivered, ${result.failed} failed, ${result.skipped} skipped`,
          );
        }
      },
    },
    {
      name: "retention purge",
      firstDelayMs: 60_000,
      intervalMs: 60 * 60 * 1000,
      lock: RETENTION_LOCK,
      run: async () => {
        const result = await purgeExpiredTrash(db);
        if (result.purged) {
          console.log(
            `Retention purge removed ${result.purged} rows across ${result.workspaces} workspace${result.workspaces === 1 ? "" : "s"}`,
          );
        }
      },
    },
    {
      name: "rate-limit sweep",
      firstDelayMs: 60_000,
      intervalMs: 60_000,
      run: async () => {
        rateLimiter.sweep();
      },
    },
  ];

  for (const job of jobs) {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        if (job.lock === undefined) {
          await job.run();
        } else {
          await locks.run(job.lock, job.run);
        }
      } catch (error) {
        if (isDatabaseUnavailable(error)) return;
        console.error(`${job.name} failed`, error);
      } finally {
        running = false;
      }
    };

    // Spread the first run so replicas do not all wake on the same millisecond.
    const jitter = Math.floor(Math.random() * Math.min(2_000, job.intervalMs / 10));
    setTimeout(() => void tick(), job.firstDelayMs + jitter).unref();
    setInterval(() => void tick(), job.intervalMs).unref();
  }
}
