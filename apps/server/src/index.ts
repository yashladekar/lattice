import app, { rateLimiter } from "./app";
import { startBackgroundJobs } from "./background-jobs";
import { attachCollaboration } from "./collaboration";
import { db } from "./services";

const server = app.listen(Number(process.env.PORT ?? 3100), () => {
  console.log(`Server is running on http://localhost:${process.env.PORT ?? 3100}`);
});

attachCollaboration(server);
startBackgroundJobs(db, rateLimiter);
