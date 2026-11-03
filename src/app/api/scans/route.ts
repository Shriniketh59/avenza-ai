import { getSession } from "@/lib/auth";
import { backendErrorResponse, flaskFetch } from "@/lib/flask";

/** Start a camera scan: an empty document that pages are added to (Flask `POST /scans`). */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  try {
    const res = await flaskFetch("/scans", { method: "POST", body: await request.text(), token: session.backendToken });
    return Response.json(await res.json().catch(() => ({})), { status: res.status });
  } catch (err) {
    return backendErrorResponse(err);
  }
}
