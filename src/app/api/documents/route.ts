import { getSession } from "@/lib/auth";
import { backendErrorResponse, flaskFetch } from "@/lib/flask";

async function relay(res: Response) {
  const body = await res.json().catch(() => ({}));
  return Response.json(body, { status: res.status });
}

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  try {
    return relay(await flaskFetch("/documents", { token: session.backendToken }));
  } catch (err) {
    return backendErrorResponse(err);
  }
}

/** Multipart upload, streamed through to Flask for parsing + embedding. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  const form = await request.formData();
  if (!(form.get("file") instanceof File)) return Response.json({ error: "No file uploaded." }, { status: 400 });
  try {
    // Let fetch set the multipart boundary header.
    return relay(
      await flaskFetch("/documents", { method: "POST", body: form, token: session.backendToken, headers: { "Content-Type": "" } }),
    );
  } catch (err) {
    return backendErrorResponse(err);
  }
}
