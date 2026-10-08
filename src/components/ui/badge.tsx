import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[0.68rem] font-medium uppercase tracking-wider text-muted",
        className,
      )}
      {...props}
    />
  );
}
