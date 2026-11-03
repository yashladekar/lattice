import { cn } from "@notes-learning/ui/lib/utils";
import Link from "next/link";

export function LatticeMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className={cn("size-8 shrink-0", className)}
    >
      <rect width="64" height="64" rx="14" className="fill-foreground" />
      <path
        d="M20 20H44M20 20V44M44 20V44M20 44H44M20 20L44 44M44 20L20 44"
        className="stroke-background/20"
        strokeWidth="1.4"
      />
      <circle cx="20" cy="20" r="6" fill="#e8892f" />
      <circle cx="44" cy="20" r="4.5" fill="#f4efe4" />
      <circle cx="20" cy="44" r="4.5" fill="#f4efe4" />
      <circle cx="44" cy="44" r="6" fill="#6f9c7d" />
    </svg>
  );
}

export function LatticeLogo({
  href = "/",
  className,
  showWordmark = true,
}: {
  href?: string | null;
  className?: string;
  showWordmark?: boolean;
}) {
  const content = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LatticeMark />
      {showWordmark ? (
        <span className="font-display text-[1.65rem] leading-none tracking-[-0.03em]">lattice</span>
      ) : null}
    </span>
  );
  if (!href) return content;
  return (
    <Link href={href} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {content}
    </Link>
  );
}
