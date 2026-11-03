import { getSession } from "@/lib/auth";
import { backendErrorResponse, flaskFetch } from "@/lib/flask";

/** Install (download) or remove one voice (Flask `POST/DELETE /voice/voices/<id>`). */
async function forward(method: "POST" | "DELETE", id: string) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  try {
    const res = await flaskFetch(`/voice/voices/${encodeURIComponent(id)}`, { method, token: session.backendToken });
    return Response.json(await res.json().catch(() => ({})), { status: res.status });
  } catch (err) {
    return backendErrorResponse(err);
  }
}

export async function POST(_request: Request, { params }: RouteContext<"/api/voice/voices/[id]">) {
  return forward("POST", (await params).id);
}

export async function DELETE(_request: Request, { params }: RouteContext<"/api/voice/voices/[id]">) {
  return forward("DELETE", (await params).id);
}
