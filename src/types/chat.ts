export type MessageRole = "user" | "assistant" | "system";

export type MessageStatus = "pending" | "streaming" | "complete" | "stopped" | "error";

export type ToolCallStatus = "queued" | "running" | "succeeded" | "failed";

export interface ToolCall {
  id: string;
  name: string;
  status: ToolCallStatus;
  summary?: string;
}

export interface AttachmentMeta {
  id: string;
  name: string;
  size: number;
  type: string;
}

export interface Source {
  index: number;
  kind?: "document" | "news" | "web";
  title?: string | null;
  url?: string | null;
  filename: string;
  documentId?: string | null;
  page?: number | null;
}

export interface UploadedDocument {
  id: string;
  filename: string;
  mimeType: string | null;
  size: number;
  chunks: number;
  /** Passages embedded so far (indexing runs in the background). */
  indexed: number;
  progress: number;
  status: "indexing" | "ready" | "error";
  error: string | null;
  createdAt: string;
}

export type Feedback = "up" | "down" | null;

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  status: MessageStatus;
  error?: string;
  feedback?: Feedback;
  toolCalls?: ToolCall[];
  attachments?: AttachmentMeta[];
  /** Attached images as small JPEG data URLs (thumbnails; full size is kept in memory for the model). */
  images?: string[];
  sources?: Source[];
}

/** Payload the frontend sends to POST /api/chat (forwarded to Flask). */
export interface ChatRequest {
  conversationId: string;
  messages: Pick<ChatMessage, "role" | "content">[];
  agentId?: string;
  memory?: boolean;
  webSearch?: boolean;
  mode?: "fast" | "accurate";
  /** Spoken conversation: ask for short, speakable answers. */
  voice?: boolean;
  /** Images for the vision model (JPEG data URLs) from the latest message that has them. */
  images?: string[];
  /** Document ids of every file attached in this conversation. */
  files?: string[];
  /** Whether the latest message itself carries file attachments. */
  filesInTurn?: boolean;
}

/**
 * Newline-delimited JSON events streamed back from /api/chat.
 * The Flask backend should emit one JSON object per line.
 */
export type ChatStreamEvent =
  | { type: "token"; value: string }
  | { type: "tool"; tool: ToolCall }
  | { type: "sources"; sources: Source[] }
  | { type: "done" }
  | { type: "error"; message: string };
