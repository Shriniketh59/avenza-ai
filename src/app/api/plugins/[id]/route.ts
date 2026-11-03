import { getSession } from "@/lib/auth";
import { backendErrorResponse, flaskFetch } from "@/lib/flask";

/** Switch one plugin on or off (Flask `PATCH /plugins/<id>`). */
export async function PATCH(request: Request, { params }: RouteContext<"/api/plugins/[id]">) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  try {
    const res = await flaskFetch(`/plugins/${encodeURIComponent(id)}`, { method: "PATCH", body: await request.text(), token: session.backendToken });
    return Response.json(await res.json().catch(() => ({})), { status: res.status });
  } catch (err) {
    return backendErrorResponse(err);
  }
}
