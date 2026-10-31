import { getSession } from "@/lib/auth";
import { backendErrorResponse, flaskFetch } from "@/lib/flask";

/** A generated document (.docx / .pdf), streamed from Flask `GET /files/<id>` to its owner as a download. */
export async function GET(_request: Request, { params }: RouteContext<"/api/files/[id]">) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  try {
    const res = await flaskFetch(`/files/${encodeURIComponent(id)}`, { token: session.backendToken });
    if (!res.ok || !res.body) return Response.json({ error: "File not found." }, { status: res.status === 404 ? 404 : 502 });
    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "application/octet-stream",
        "Content-Disposition": res.headers.get("Content-Disposition") ?? "attachment",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (err) {
    return backendErrorResponse(err);
  }
}
