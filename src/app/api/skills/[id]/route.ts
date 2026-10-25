import { getSession } from "@/lib/auth";
import { backendErrorResponse, flaskFetch } from "@/lib/flask";

/** Edit or delete one skill (Flask `PATCH/DELETE /skills/<id>`). */
async function forward(method: "PATCH" | "DELETE", id: string, body?: string) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  try {
    const res = await flaskFetch(`/skills/${encodeURIComponent(id)}`, { method, body, token: session.backendToken });
    return Response.json(await res.json().catch(() => ({})), { status: res.status });
  } catch (err) {
    return backendErrorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/skills/[id]">) {
  return forward("PATCH", (await params).id, await request.text());
}

export async function DELETE(_request: Request, { params }: RouteContext<"/api/skills/[id]">) {
  return forward("DELETE", (await params).id);
}
