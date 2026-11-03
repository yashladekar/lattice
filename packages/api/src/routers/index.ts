import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { aiRouter } from "./ai";
import { canvasRouter } from "./canvas";
import { captureRouter } from "./capture";
import { commentRouter } from "./comment";
import { graphRouter } from "./graph";
import { learningRouter } from "./learning";
import { notebookRouter } from "./notebook";
import { deviceRouter, notificationRouter } from "./notification";
import { pageRouter } from "./page";
import { presenceRouter } from "./presence";
import { searchRouter } from "./search";
import { shareRouter } from "./share";
import { syncRouter } from "./sync";
import { attachmentRouter, templateRouter } from "./template";
import { workspaceRouter } from "./workspace";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  privateData: protectedProcedure.handler(({ context }) => {
    return {
      message: "This is private",
      user: context.session.user,
    };
  }),
  workspace: workspaceRouter,
  notebook: notebookRouter,
  page: pageRouter,
  canvas: canvasRouter,
  graph: graphRouter,
  capture: captureRouter,
  learning: learningRouter,
  comment: commentRouter,
  share: shareRouter,
  search: searchRouter,
  ai: aiRouter,
  sync: syncRouter,
  presence: presenceRouter,
  notification: notificationRouter,
  device: deviceRouter,
  template: templateRouter,
  attachment: attachmentRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
