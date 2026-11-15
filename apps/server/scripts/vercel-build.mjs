import { execSync } from "node:child_process";

/**
 * Vercel builds only the API service here. This owns Prisma generation and
 * production migrations. The Express entry is bundled from source by Vercel,
 * so it must not build dist: a prebuilt output would make the builder treat
 * that directory as the function and drop its external dependencies.
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
