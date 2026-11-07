"use client";

import { Toaster } from "@notes-learning/ui/components/sonner";
import { TooltipProvider } from "@notes-learning/ui/components/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

import { getQueryClient } from "@/utils/orpc";

import { AppDataProvider } from "./app-data-provider";
import { DesktopDeepLink } from "./desktop-deep-link";
import { DesktopUpdater } from "./desktop-updater";
import { ExternalLinkHandler } from "./external-links";
import { ThemeProvider } from "./theme-provider";

export default function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delay={250}>
          <AppDataProvider>{children}</AppDataProvider>
        </TooltipProvider>
        <ReactQueryDevtools />
      </QueryClientProvider>
      <ExternalLinkHandler />
      <DesktopUpdater />
      <DesktopDeepLink />
      <Toaster richColors position="bottom-right" />
    </ThemeProvider>
  );
}
