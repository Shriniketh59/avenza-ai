import { getSession } from "@/lib/auth";
import { backendErrorResponse, flaskFetch } from "@/lib/flask";

/** Update an imported skill from its GitHub source (Flask `POST /skills/<id>/refresh`). */
export async function POST(_request: Request, { params }: RouteContext<"/api/skills/[id]/refresh">) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  try {
    const res = await flaskFetch(`/skills/${encodeURIComponent(id)}/refresh`, { method: "POST", token: session.backendToken });
    return Response.json(await res.json().catch(() => ({})), { status: res.status });
  } catch (err) {
    return backendErrorResponse(err);
  }
}
