import { createSession } from "@/lib/auth";
import { toUser, type BackendAuthResponse } from "@/lib/backend-user";
import { backendErrorResponse, flaskJson } from "@/lib/flask";
import { loginSchema, toFieldErrors } from "@/lib/validations";

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Check the highlighted fields.", fields: toFieldErrors(parsed.error) }, { status: 400 });
  }
  const { email, password, remember } = parsed.data;
  try {
    const data = await flaskJson<BackendAuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    const session = await createSession(toUser(data.user, "credentials"), { remember, backendToken: data.token });
    return Response.json({ user: session.user });
  } catch (err) {
    return backendErrorResponse(err);
  }
}
