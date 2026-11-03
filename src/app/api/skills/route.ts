import { getSession } from "@/lib/auth";
import { backendErrorResponse, flaskFetch } from "@/lib/flask";

/** The signed-in user's skills (Flask `GET/POST /skills`). */
async function forward(method: "GET" | "POST", body?: string) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  try {
    const res = await flaskFetch("/skills", { method, body, token: session.backendToken });
    return Response.json(await res.json().catch(() => ({})), { status: res.status });
  } catch (err) {
    return backendErrorResponse(err);
  }
}

export const GET = () => forward("GET");
export const POST = async (request: Request) => forward("POST", await request.text());
