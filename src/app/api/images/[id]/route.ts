import { getSession } from "@/lib/auth";
import { backendErrorResponse, flaskFetch } from "@/lib/flask";

/** A generated image, streamed from Flask `GET /images/<id>` (only its owner can load it). */
export async function GET(_request: Request, { params }: RouteContext<"/api/images/[id]">) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  try {
    const res = await flaskFetch(`/images/${encodeURIComponent(id)}`, { token: session.backendToken });
    if (!res.ok || !res.body) return Response.json({ error: "Image not found." }, { status: res.status === 404 ? 404 : 502 });
    return new Response(res.body, {
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "image/png", "Cache-Control": "private, max-age=86400" },
    });
  } catch (err) {
    return backendErrorResponse(err);
  }
}
