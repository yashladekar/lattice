import { execSync } from "node:child_process";

/**
 * Vercel builds only the API service here. The web service has its own build
 * command, so this one owns Prisma generation and production migrations.
 * Preview deployments generate the client but never touch the database.
 */
function run(command) {
  console.log(`$ ${command}`);
  execSync(command, { stdio: "inherit" });
}

run("pnpm -w env:generate");
run("pnpm --filter @notes-learning/db db:generate");

if (process.env.VERCEL_ENV === "production") {
  run("pnpm --filter @notes-learning/db db:migrate:deploy");
}

run("pnpm --filter server build");
