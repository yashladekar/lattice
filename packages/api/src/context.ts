import type { Session } from "@notes-learning/auth";
import type { Database } from "@notes-learning/db";

export type Context = {
  session: Session | null;
  db: Database;
};
