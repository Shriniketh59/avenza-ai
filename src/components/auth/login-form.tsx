"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ApiError, authApi } from "@/lib/api-client";
import { backendHint } from "@/lib/auth-errors";
import { loginSchema, toFieldErrors, type FieldErrors, type LoginInput } from "@/lib/validations";
import { PasswordInput } from "./password-input";

export function LoginForm({ next, initialError }: { next: string; initialError: string | null }) {
  const router = useRouter();
  const [values, setValues] = useState<LoginInput>({ email: "", password: "", remember: false });
  const [errors, setErrors] = useState<FieldErrors<LoginInput>>({});
  const [formError, setFormError] = useState<string | null>(initialError);
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");

  const set = <K extends keyof LoginInput>(key: K, value: LoginInput[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) return setErrors(toFieldErrors(parsed.error));

    setStatus("loading");
    try {
      await authApi.login(parsed.data);
      setStatus("success");
      router.replace(next);
      router.refresh();
    } catch (err) {
      setStatus("idle");
      if (err instanceof ApiError) {
        if (err.fields) setErrors(err.fields);
        setFormError(backendHint(err.code) ?? err.message);
      } else setFormError("Something went wrong. Please try again.");
    }
  }

  const busy = status !== "idle";
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {formError && <Alert>{formError}</Alert>}
      {status === "success" && <Alert tone="success">Signed in. Opening your workspace…</Alert>}

      <Field id="email" label="Email" error={errors.email}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={values.email}
          onChange={(e) => set("email", e.target.value)}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "email-error" : undefined}
          disabled={busy}
        />
      </Field>

      <Field
        id="password"
        label="Password"
        error={errors.password}
        action={
          <Link href="/forgot-password" className="text-xs font-medium text-accent hover:underline">
            Forgot password?
          </Link>
        }
      >
        <PasswordInput
          id="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          value={values.password}
          onChange={(e) => set("password", e.target.value)}
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? "password-error" : undefined}
          disabled={busy}
        />
      </Field>

      <label className="flex cursor-pointer items-center gap-2.5 text-sm text-muted">
        <Checkbox checked={values.remember} onChange={(e) => set("remember", e.target.checked)} disabled={busy} />
        Keep me signed in for 30 days
      </label>

      <Button type="submit" variant="gradient" size="lg" className="w-full" disabled={busy}>
        {status === "loading" && <Loader2 className="animate-spin" />}
        {status === "loading" ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
