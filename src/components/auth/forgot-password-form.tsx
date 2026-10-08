"use client";

import { useState, type FormEvent } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ApiError, authApi } from "@/lib/api-client";
import { backendHint } from "@/lib/auth-errors";
import { forgotPasswordSchema } from "@/lib/validations";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "sent">("idle");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Invalid email");
    setStatus("loading");
    try {
      await authApi.forgotPassword(parsed.data);
      setStatus("sent");
    } catch (err) {
      setStatus("idle");
      setFormError(err instanceof ApiError ? (backendHint(err.code) ?? err.message) : "Something went wrong.");
    }
  }

  if (status === "sent") {
    return (
      <div className="space-y-3 rounded-xl border border-border bg-surface p-5 text-sm" role="status">
        <MailCheck className="size-6 text-accent" aria-hidden />
        <p className="font-medium">Check your inbox</p>
        <p className="text-muted">If an account exists for {email}, a reset link is on its way.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {formError && <Alert>{formError}</Alert>}
      <Field id="email" label="Email" error={error ?? undefined}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "email-error" : undefined}
          disabled={status === "loading"}
        />
      </Field>
      <Button type="submit" variant="gradient" size="lg" className="w-full" disabled={status === "loading"}>
        {status === "loading" && <Loader2 className="animate-spin" />}
        Send reset link
      </Button>
    </form>
  );
}
