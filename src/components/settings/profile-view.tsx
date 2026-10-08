"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ApiError, authApi } from "@/lib/api-client";
import { profileSchema } from "@/lib/validations";
import { UserAvatar } from "../user-avatar";
import { useShell } from "../workspace-shell";
import { SettingRow, SettingsSection } from "./section";

export function ProfileView() {
  const { user } = useShell();
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setResult(null);
    const parsed = profileSchema.safeParse({ name });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Invalid name");
    setSaving(true);
    try {
      await authApi.updateProfile(parsed.data, user);
      setResult({ tone: "success", text: "Profile updated." });
      router.refresh();
    } catch (err) {
      setResult({ tone: "error", text: err instanceof ApiError ? err.message : "Could not save your profile." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-8">
      <SettingsSection title="Profile">
        <div className="flex items-center gap-4 pb-5">
          <UserAvatar user={user} className="size-16 text-lg" />
          <div className="min-w-0">
            <p className="truncate font-medium">{user.name}</p>
            <p className="truncate text-sm text-muted">{user.email}</p>
            <p className="mt-1 text-xs text-muted">
              {user.provider === "google" ? "Picture managed by your Google account." : "Profile picture upload is coming soon."}
            </p>
          </div>
        </div>
        <form onSubmit={onSubmit} noValidate className="space-y-4 pt-5">
          {result && <Alert tone={result.tone}>{result.text}</Alert>}
          <Field id="name" label="Display name" error={error ?? undefined}>
            <Input
              id="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "name-error" : undefined}
            />
          </Field>
          <Field id="email" label="Email" hint="Contact support to change your email.">
            <Input id="email" value={user.email} readOnly disabled />
          </Field>
          <Button type="submit" disabled={saving || name.trim() === user.name}>
            {saving && <Loader2 className="animate-spin" />}
            Save changes
          </Button>
        </form>
      </SettingsSection>

      <SettingsSection title="Account information">
        <SettingRow label="Account ID" control={<code className="font-mono text-xs text-muted">{user.id}</code>} />
        <SettingRow label="Sign-in method" control={<span className="text-sm text-muted">{user.provider === "google" ? "Google" : "Email & password"}</span>} />
        {user.createdAt && <SettingRow label="Member since" control={<span className="text-sm text-muted">{new Date(user.createdAt).toLocaleDateString()}</span>} />}
      </SettingsSection>
    </div>
  );
}
