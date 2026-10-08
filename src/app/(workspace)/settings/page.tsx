import type { Metadata } from "next";
import { PageFrame } from "@/components/page-frame";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <PageFrame title="Settings">
      <SettingsView />
    </PageFrame>
  );
}
