"use client";

import { Loader2 } from "lucide-react";

import { LatticeMark } from "@/components/brand/logo";

export function AppSplash({ label = "Opening your lattice" }: { label?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <div className="flex flex-col items-center">
        <div className="relative">
          <LatticeMark className="size-10" />
          <span className="absolute -inset-3 rounded-2xl border border-saffron/20" />
        </div>
        <div className="mt-5 flex items-center gap-2 text-[10px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {label}
        </div>
      </div>
    </div>
  );
}
