import { getSession, updateSessionUser } from "@/lib/auth";
import { isBackendConfigured } from "@/lib/env";
import { backendErrorResponse, flaskJson } from "@/lib/flask";
import { profileSchema, toFieldErrors } from "@/lib/validations";

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });

  const parsed = profileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Check the highlighted fields.", fields: toFieldErrors(parsed.error) }, { status: 400 });
  }
  if (!isBackendConfigured()) {
    return Response.json(
      { error: "Profile changes need the AVENZA backend (FLASK_API_URL).", code: "BACKEND_NOT_CONFIGURED" },
      { status: 503 },
    );
  }
  try {
    await flaskJson("/users/me", { method: "PATCH", body: JSON.stringify(parsed.data), token: session.backendToken });
    const updated = await updateSessionUser({ name: parsed.data.name });
    return Response.json({ user: updated?.user });
  } catch (err) {
    return backendErrorResponse(err);
  }
}
