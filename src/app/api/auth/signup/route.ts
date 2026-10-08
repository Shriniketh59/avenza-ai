import { createSession } from "@/lib/auth";
import { toUser, type BackendAuthResponse } from "@/lib/backend-user";
import { backendErrorResponse, flaskJson } from "@/lib/flask";
import { signupSchema, toFieldErrors } from "@/lib/validations";

export async function POST(request: Request) {
  const parsed = signupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Check the highlighted fields.", fields: toFieldErrors(parsed.error) }, { status: 400 });
  }
  const { name, email, password } = parsed.data;
  try {
    const data = await flaskJson<BackendAuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    });
    const session = await createSession(toUser(data.user, "credentials"), { remember: false, backendToken: data.token });
    return Response.json({ user: session.user }, { status: 201 });
  } catch (err) {
    return backendErrorResponse(err);
  }
}
