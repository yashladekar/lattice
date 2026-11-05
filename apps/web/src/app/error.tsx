"use client";

import { Button } from "@notes-learning/ui/components/button";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route error:", error);
  }, [error]);

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6">
      <div className="max-w-md text-center">
        <span className="mx-auto grid size-10 place-items-center rounded-xl border border-border bg-card">
          <TriangleAlert className="size-4 text-saffron" />
        </span>
        <h1 className="mt-3 font-display text-3xl tracking-[-0.03em]">
          Something broke on this screen
        </h1>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Writes go to local storage first, so work saved before this point is still on this
          device. Try again, or open the workspace from the start.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button size="sm" className="h-8 rounded-lg text-[10px]" onClick={reset}>
            <RefreshCw className="size-3" /> Try again
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-lg text-[10px]"
            onClick={() => {
              window.location.assign("/");
            }}
          >
            Back to the start
          </Button>
        </div>
      </div>
    </div>
  );
}
