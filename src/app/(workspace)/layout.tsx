import { WorkspaceShell } from "@/components/workspace-shell";
import { requireUser } from "@/lib/auth";

export default async function WorkspaceLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return <WorkspaceShell user={user}>{children}</WorkspaceShell>;
}
