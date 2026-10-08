import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AuthCardHeader } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-6">
      <AuthCardHeader title="Reset your password" subtitle="Enter your email and we'll send you a reset link." />
      <ForgotPasswordForm />
      <Link href="/login" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#19e3b5] hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Back to sign in
      </Link>
    </div>
  );
}
