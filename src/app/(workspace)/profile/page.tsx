import type { Metadata } from "next";
import { PageFrame } from "@/components/page-frame";
import { ProfileView } from "@/components/settings/profile-view";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <PageFrame title="Profile">
      <ProfileView />
    </PageFrame>
  );
}
