import { getSession } from "@/lib/auth";
import { backendErrorResponse, flaskFetch } from "@/lib/flask";

export async function DELETE(_request: Request, { params }: RouteContext<"/api/documents/[id]">) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  try {
    const res = await flaskFetch(`/documents/${encodeURIComponent(id)}`, { method: "DELETE", token: session.backendToken });
    return Response.json(await res.json().catch(() => ({})), { status: res.status });
  } catch (err) {
    return backendErrorResponse(err);
  }
}

export async function GET(_request: Request, { params }: RouteContext<"/api/documents/[id]">) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  try {
    const res = await flaskFetch(`/documents/${encodeURIComponent(id)}`, { token: session.backendToken });
    return Response.json(await res.json().catch(() => ({})), { status: res.status });
  } catch (err) {
    return backendErrorResponse(err);
  }
}
