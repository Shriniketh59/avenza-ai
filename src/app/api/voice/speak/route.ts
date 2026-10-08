import { z } from "zod";
import { getSession } from "@/lib/auth";
import { backendErrorResponse, flaskFetch } from "@/lib/flask";

const speakSchema = z.object({
  text: z.string().min(1).max(4000),
  voice: z.string().max(80).optional(),
  speed: z.number().min(0.6).max(1.8).optional(),
});

/** Text -> local Piper speech (WAV). */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  const parsed = speakSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid speech request." }, { status: 400 });
  try {
    const res = await flaskFetch("/voice/speak", {
      method: "POST",
      body: JSON.stringify(parsed.data),
      token: session.backendToken,
      signal: request.signal,
    });
    if (!res.ok) return Response.json(await res.json().catch(() => ({})), { status: res.status });
    return new Response(res.body, { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
  } catch (err) {
    return backendErrorResponse(err);
  }
}
