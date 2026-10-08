import { z } from "zod";
import { getSession } from "@/lib/auth";
import { backendErrorResponse, flaskFetch } from "@/lib/flask";

const chatSchema = z.object({
  conversationId: z.string().min(1),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant", "system"]), content: z.string().max(32000) }))
    .min(1)
    .max(200),
  agentId: z.string().optional(),
  memory: z.boolean().optional(),
  webSearch: z.boolean().optional(),
  mode: z.enum(["fast", "accurate"]).optional(),
  voice: z.boolean().optional(),
  images: z.array(z.string().startsWith("data:image/").max(6_000_000)).max(4).optional(),
  files: z.array(z.string().min(1).max(64)).max(20).optional(),
  filesInTurn: z.boolean().optional(),
});

/**
 * Proxies a chat turn to Flask `POST /chat` and pipes its NDJSON stream
 * straight through. No responses are generated here.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Your session expired. Sign in again." }, { status: 401 });

  const parsed = chatSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid chat request." }, { status: 400 });

  try {
    const upstream = await flaskFetch("/chat", {
      method: "POST",
      body: JSON.stringify({ ...parsed.data, user_id: session.user.id }),
      token: session.backendToken,
      signal: request.signal,
      headers: { Accept: "application/x-ndjson" },
    });
    if (!upstream.ok || !upstream.body) {
      const body = (await upstream.json().catch(() => ({}))) as { error?: string };
      return Response.json({ error: body.error ?? "The assistant failed to respond." }, { status: 502 });
    }
    return new Response(upstream.body, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return backendErrorResponse(err);
  }
}
