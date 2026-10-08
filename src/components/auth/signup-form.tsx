"use client";

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
import { signupSchema, toFieldErrors, type FieldErrors } from "@/lib/validations";
import { PasswordChecklist } from "./password-checklist";
import { PasswordInput } from "./password-input";

interface Values {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
}

export function SignupForm() {
  const router = useRouter();
  const [values, setValues] = useState<Values>({ name: "", email: "", password: "", confirmPassword: "", acceptTerms: false });
  const [errors, setErrors] = useState<FieldErrors<Values>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = signupSchema.safeParse(values);
    if (!parsed.success) return setErrors(toFieldErrors(parsed.error));

    setStatus("loading");
    try {
      await authApi.signup(parsed.data);
      setStatus("success");
      router.replace("/chat");
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
  const input = (key: "name" | "email", type: string, autoComplete: string, placeholder: string) => (
    <Input
      id={key}
      type={type}
      autoComplete={autoComplete}
      placeholder={placeholder}
      value={values[key]}
      onChange={(e) => set(key, e.target.value)}
      aria-invalid={Boolean(errors[key])}
      aria-describedby={errors[key] ? `${key}-error` : undefined}
      disabled={busy}
    />
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && <Alert>{formError}</Alert>}
      {status === "success" && <Alert tone="success">Account created. Opening your workspace…</Alert>}

      <Field id="name" label="Full name" error={errors.name}>
        {input("name", "text", "name", "Jordan Lee")}
      </Field>
      <Field id="email" label="Work email" error={errors.email}>
        {input("email", "email", "email", "you@company.com")}
      </Field>
      <Field id="password" label="Password" error={errors.password} hint={<PasswordChecklist value={values.password} />}>
        <PasswordInput
          id="password"
          autoComplete="new-password"
          placeholder="Create a password"
          value={values.password}
          onChange={(e) => set("password", e.target.value)}
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? "password-error" : undefined}
          disabled={busy}
        />
      </Field>
      <Field id="confirmPassword" label="Confirm password" error={errors.confirmPassword}>
        <PasswordInput
          id="confirmPassword"
          autoComplete="new-password"
          placeholder="Repeat your password"
          value={values.confirmPassword}
          onChange={(e) => set("confirmPassword", e.target.value)}
          aria-invalid={Boolean(errors.confirmPassword)}
          aria-describedby={errors.confirmPassword ? "confirmPassword-error" : undefined}
          disabled={busy}
        />
      </Field>

      <div className="space-y-1">
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-muted">
          <Checkbox
            className="mt-0.5"
            checked={values.acceptTerms}
            onChange={(e) => set("acceptTerms", e.target.checked)}
            aria-invalid={Boolean(errors.acceptTerms)}
            disabled={busy}
          />
          <span>
            I agree to the <a href="#" className="text-accent hover:underline">Terms of Service</a> and{" "}
            <a href="#" className="text-accent hover:underline">Privacy Policy</a>.
          </span>
        </label>
        {errors.acceptTerms && <p role="alert" className="text-xs text-danger">{errors.acceptTerms}</p>}
      </div>

      <Button type="submit" variant="gradient" size="lg" className="w-full" disabled={busy}>
        {status === "loading" && <Loader2 className="animate-spin" />}
        {status === "loading" ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
