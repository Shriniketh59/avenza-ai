import type { Metadata } from "next";
import { ChatWindow } from "@/components/chat-window";

export const metadata: Metadata = { title: "Chat" };

export default function ChatPage() {
  return <ChatWindow />;
}
