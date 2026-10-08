"use client";

import type { ReactNode } from "react";
import { WorkspaceHeader } from "./workspace-header";

export function PageFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <WorkspaceHeader title={<h1 className="px-1 text-sm font-semibold">{title}</h1>} />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </>
  );
}
