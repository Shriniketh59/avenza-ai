import type { Metadata } from "next";
import { connection } from "next/server";
import { AuthCardHeader, AuthTabs } from "@/components/auth/auth-card";
import { AuthDivider } from "@/components/auth/divider";
import { GoogleButton } from "@/components/auth/google-button";
import { PreviewNotice } from "@/components/auth/preview-notice";
import { SignupForm } from "@/components/auth/signup-form";
import { isBackendConfigured, isGoogleConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage() {
  await connection(); // read OAuth config at request time, not build time
  return (
    <div className="space-y-5">
      <AuthCardHeader title="Create your account" subtitle="Start asking smarter questions in minutes." />
      <AuthTabs active="signup" />
      {!isBackendConfigured() && <PreviewNotice />}
      <GoogleButton enabled={isGoogleConfigured()} label="Sign up with Google" />
      <AuthDivider />
      <SignupForm />
    </div>
  );
}
