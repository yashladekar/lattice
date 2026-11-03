import type { Session } from "@notes-learning/auth";
import type { Database } from "@notes-learning/db";

export type AiConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type Context = {
  session: Session | null;
  db: Database;
  ai: AiConfig | null;
  headers: Headers;
};
