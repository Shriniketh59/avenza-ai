import { getSession } from "@/lib/auth";
import { backendErrorResponse, flaskFetch } from "@/lib/flask";

/** Audio clip -> local Whisper transcription (+ detected voice command). */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  const form = await request.formData();
  if (!(form.get("audio") instanceof Blob)) return Response.json({ error: "No audio uploaded." }, { status: 400 });
  try {
    const res = await flaskFetch("/voice/transcribe", {
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
