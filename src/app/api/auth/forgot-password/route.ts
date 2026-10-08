import { backendErrorResponse, flaskJson } from "@/lib/flask";
import { forgotPasswordSchema, toFieldErrors } from "@/lib/validations";

export async function POST(request: Request) {
  const parsed = forgotPasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Enter a valid email address.", fields: toFieldErrors(parsed.error) }, { status: 400 });
  }
  try {
    await flaskJson("/auth/forgot-password", { method: "POST", body: JSON.stringify(parsed.data) });
    // Always succeed from the client's view so account existence is not revealed.
    return Response.json({ ok: true });
  } catch (err) {
    return backendErrorResponse(err);
  }
}
