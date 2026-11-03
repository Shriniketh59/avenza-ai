import { getSession } from "@/lib/auth";
import { backendErrorResponse, flaskFetch } from "@/lib/flask";

/** One camera photo, read into the scan (Flask `POST /scans/<id>/pages`). The vision model can take ~10 s. */
export const maxDuration = 120;

export async function POST(request: Request, { params }: RouteContext<"/api/scans/[id]/pages">) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const form = await request.formData();
  if (!(form.get("image") instanceof File)) return Response.json({ error: "No photo uploaded." }, { status: 400 });
  try {
    // Let fetch set the multipart boundary header.
    const res = await flaskFetch(`/scans/${encodeURIComponent(id)}/pages`, {
      method: "POST",
      body: form,
      token: session.backendToken,
      headers: { "Content-Type": "" },
    });
    return Response.json(await res.json().catch(() => ({})), { status: res.status });
  } catch (err) {
    return backendErrorResponse(err);
  }
}
