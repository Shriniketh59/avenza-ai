import type { Metadata } from "next";
import { AuthCardHeader, AuthLegal, AuthTabs } from "@/components/auth/auth-card";
import { AuthDivider } from "@/components/auth/divider";
import { GoogleButton } from "@/components/auth/google-button";
import { LoginForm } from "@/components/auth/login-form";
import { PreviewNotice } from "@/components/auth/preview-notice";
import { authErrorMessage } from "@/lib/auth-errors";
import { isBackendConfigured, isGoogleConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const rawNext = typeof params.next === "string" ? params.next : "/chat";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/chat";
  const error = authErrorMessage(typeof params.error === "string" ? params.error : null);

  return (
    <div className="space-y-5">
      <AuthCardHeader title="Welcome back" subtitle="Sign in to continue to AVENZA AI." />
      <AuthTabs active="login" />
      {!isBackendConfigured() && <PreviewNotice />}
      <GoogleButton enabled={isGoogleConfigured()} label="Continue with Google" next={next} />
      <AuthDivider />
      <LoginForm next={next} initialError={error} />
      <AuthLegal />
    </div>
  );
}
