"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { ApiError, streamChat } from "@/lib/api-client";
import { usePreferences } from "@/hooks/use-preferences";
import { createId, titleFromMessage } from "@/lib/utils";
import type { PickedImage } from "@/lib/images";
import type { AttachmentMeta, ChatMessage, Feedback, ToolCall } from "@/types/chat";
import type { Conversation } from "@/types/conversation";

/**
 * Client-side conversation state, saved per user in this browser
 * (localStorage). Swap load/save for Flask endpoints once a conversation API exists.
 */

const storageKey = (userId: string) => `avenza.conversations.${userId}`;

function loadConversations(userId: string): Conversation[] {
  try {
    const list = JSON.parse(localStorage.getItem(storageKey(userId)) ?? "[]") as Conversation[];
    // A reload mid-stream leaves half-finished replies: mark them stopped.
    return list.map((c) => ({
      ...c,
      messages: c.messages.map((m) => (m.status === "pending" || m.status === "streaming" ? { ...m, status: "stopped" } : m)),
    }));
  } catch {
    return [];
  }
}

interface State {
  conversations: Conversation[];
  activeId: string | null;
  generatingId: string | null; // assistant message currently streaming
  hydrated: boolean;
}

type Action =
  | { type: "hydrate"; conversations: Conversation[] }
  | { type: "create"; conversation: Conversation }
  | { type: "select"; id: string | null }
  | { type: "rename"; id: string; title: string }
  | { type: "delete"; id: string }
  | { type: "append"; id: string; messages: ChatMessage[] }
  | { type: "patchMessage"; id: string; messageId: string; patch: (m: ChatMessage) => Partial<ChatMessage> }
  | { type: "removeMessage"; id: string; messageId: string }
  | { type: "generating"; messageId: string | null };

function mapConversation(state: State, id: string, fn: (c: Conversation) => Conversation): State {
  return { ...state, conversations: state.conversations.map((c) => (c.id === id ? fn(c) : c)) };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "hydrate":
      return { ...state, conversations: action.conversations, hydrated: true };
    case "create":
      return { ...state, conversations: [action.conversation, ...state.conversations], activeId: action.conversation.id };
    case "select":
      return { ...state, activeId: action.id };
    case "rename":
      return mapConversation(state, action.id, (c) => ({ ...c, title: action.title }));
    case "delete":
      return {
        ...state,
        conversations: state.conversations.filter((c) => c.id !== action.id),
        activeId: state.activeId === action.id ? null : state.activeId,
      };
    case "append":
      return mapConversation(state, action.id, (c) => ({
        ...c,
        updatedAt: Date.now(),
        messages: [...c.messages, ...action.messages],
      }));
    case "patchMessage":
      return mapConversation(state, action.id, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === action.messageId ? { ...m, ...action.patch(m) } : m)),
      }));
    case "removeMessage":
      return mapConversation(state, action.id, (c) => ({ ...c, messages: c.messages.filter((m) => m.id !== action.messageId) }));
    case "generating":
      return { ...state, generatingId: action.messageId };
  }
}

export interface SendOptions {
  voice?: boolean;
  images?: PickedImage[];
}

/** Full-size images by message id. Only thumbnails are saved with the conversation (localStorage is small). */
const fullImages = new Map<string, string[]>();

/** What the backend needs from the history: images to look at and files attached to this conversation. */
function attachmentsFor(history: ChatMessage[]) {
  const users = history.filter((m) => m.role === "user");
  const last = users.at(-1);
  // Follow-ups about an image ("and the bottom row?") need it again; look back a few messages.
  const withImages = users.slice(-3).reverse().find((m) => m.images?.length);
  const images = withImages ? (fullImages.get(withImages.id) ?? withImages.images) : undefined;
  const files = [...new Set(users.flatMap((m) => m.attachments?.map((a) => a.id) ?? []))];
  return { images, files: files.length ? files : undefined, filesInTurn: Boolean(last?.attachments?.length) };
}

interface Store extends State {
  active: Conversation | null;
  newChat: () => void;
  select: (id: string) => void;
  rename: (id: string, title: string) => void;
  remove: (id: string) => void;
  send: (content: string, attachments?: AttachmentMeta[], options?: SendOptions) => Promise<void>;
  stop: () => void;
  regenerate: () => Promise<void>;
  setFeedback: (messageId: string, feedback: Feedback) => void;
}

const ConversationContext = createContext<Store | null>(null);

export function ConversationProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { conversations: [], activeId: null, generatingId: null, hydrated: false });

  useEffect(() => {
    dispatch({ type: "hydrate", conversations: loadConversations(userId) });
  }, [userId]);

  useEffect(() => {
    if (!state.hydrated) return;
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(state.conversations));
    } catch {
      /* storage full or blocked: keep in memory */
    }
  }, [state.conversations, state.hydrated, userId]);
  const abortRef = useRef<AbortController | null>(null);
  const [prefs] = usePreferences();
  const prefsRef = useRef(prefs);
  useLayoutEffect(() => {
    prefsRef.current = prefs;
  });
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });

  const runAssistant = useCallback(async (conversationId: string, history: ChatMessage[], options: SendOptions = {}) => {
    const assistant: ChatMessage = {
      id: createId("msg"),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      status: "pending",
    };
    dispatch({ type: "append", id: conversationId, messages: [assistant] });
    dispatch({ type: "generating", messageId: assistant.id });

    const patch = (fn: (m: ChatMessage) => Partial<ChatMessage>) =>
      dispatch({ type: "patchMessage", id: conversationId, messageId: assistant.id, patch: fn });

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const stream = streamChat(
        {
          conversationId,
          messages: history.filter((m) => m.status !== "error" && m.content).map(({ role, content }) => ({ role, content })),
          memory: prefsRef.current.memoryEnabled,
          webSearch: prefsRef.current.webSearch,
          mode: prefsRef.current.mode,
          agentId: prefsRef.current.agent,
          voice: options.voice,
          ...attachmentsFor(history),
        },
        controller.signal,
      );
      for await (const event of stream) {
        if (event.type === "token") patch((m) => ({ content: m.content + event.value, status: "streaming" }));
        else if (event.type === "tool") patch((m) => ({ toolCalls: upsertTool(m.toolCalls, event.tool) }));
        else if (event.type === "sources") patch(() => ({ sources: event.sources }));
        else if (event.type === "error") throw new ApiError(event.message, 500);
        else if (event.type === "done") break;
      }
      patch(() => ({ status: "complete" }));
    } catch (err) {
      if (controller.signal.aborted) patch(() => ({ status: "stopped" }));
      else {
        const message = err instanceof ApiError ? err.message : "The response was interrupted. Try again.";
        patch(() => ({ status: "error", error: message }));
      }
    } finally {
      abortRef.current = null;
      dispatch({ type: "generating", messageId: null });
    }
  }, []);

  const send = useCallback(
    async (content: string, attachments?: AttachmentMeta[], options?: SendOptions) => {
      const text = content.trim();
      if (!text || stateRef.current.generatingId) return;

      let conversation = stateRef.current.conversations.find((c) => c.id === stateRef.current.activeId);
      if (!conversation) {
        conversation = { id: createId("conv"), title: titleFromMessage(text), createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
        dispatch({ type: "create", conversation });
      }
      const userMessage: ChatMessage = {
        id: createId("msg"),
        role: "user",
        content: text,
        createdAt: Date.now(),
        status: "complete",
        attachments: attachments?.length ? attachments : undefined,
        images: options?.images?.length ? options.images.map((i) => i.thumb) : undefined,
      };
      if (options?.images?.length) fullImages.set(userMessage.id, options.images.map((i) => i.full));
      dispatch({ type: "append", id: conversation.id, messages: [userMessage] });
      await runAssistant(conversation.id, [...conversation.messages, userMessage], options);
    },
    [runAssistant],
  );

  const regenerate = useCallback(async () => {
    const { activeId, conversations, generatingId } = stateRef.current;
    const conversation = conversations.find((c) => c.id === activeId);
    if (!conversation || generatingId) return;
    const last = conversation.messages.at(-1);
    if (!last || last.role !== "assistant") return;
    dispatch({ type: "removeMessage", id: conversation.id, messageId: last.id });
    await runAssistant(conversation.id, conversation.messages.slice(0, -1));
  }, [runAssistant]);

  const store = useMemo<Store>(
    () => ({
      ...state,
      active: state.conversations.find((c) => c.id === state.activeId) ?? null,
      newChat: () => {
        abortRef.current?.abort();
        dispatch({ type: "select", id: null });
      },
      select: (id) => dispatch({ type: "select", id }),
      rename: (id, title) => {
        const clean = title.trim();
        if (clean) dispatch({ type: "rename", id, title: clean.slice(0, 80) });
      },
      remove: (id) => {
        if (stateRef.current.activeId === id) abortRef.current?.abort();
        dispatch({ type: "delete", id });
      },
      send,
      stop: () => abortRef.current?.abort(),
      regenerate,
      setFeedback: (messageId, feedback) => {
        if (state.activeId) dispatch({ type: "patchMessage", id: state.activeId, messageId, patch: () => ({ feedback }) });
      },
    }),
    [state, send, regenerate],
  );

  return <ConversationContext.Provider value={store}>{children}</ConversationContext.Provider>;
}

function upsertTool(list: ToolCall[] | undefined, tool: ToolCall): ToolCall[] {
  const existing = list ?? [];
  return existing.some((t) => t.id === tool.id) ? existing.map((t) => (t.id === tool.id ? tool : t)) : [...existing, tool];
}

export function useConversations(): Store {
  const ctx = useContext(ConversationContext);
  if (!ctx) throw new Error("useConversations must be used inside <ConversationProvider>");
  return ctx;
}
