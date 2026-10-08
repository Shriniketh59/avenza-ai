import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bot,
  BrainCircuit,
  Bug,
  Code2,
  Database,
  FileSearch,
  FileText,
  Files,
  ImageIcon,
  Lightbulb,
  Mic,
  Sigma,
  Sparkles,
  Workflow,
  Wrench,
} from "lucide-react";

export type FeatureStatus = "available" | "coming_soon";

export interface Feature {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  status: FeatureStatus;
}

/**
 * Single switchboard for AVENZA AI capabilities. Flip a status to "available"
 * once its backend ships; UI that depends on it reads from here.
 */
export const FEATURES: Feature[] = [
  { id: "chat", title: "LLM conversations", description: "Streaming chat with the AVENZA model.", icon: Bot, status: "available" },
  { id: "agents", title: "Agentic workspace", description: "Multi-step agents that plan and run tools.", icon: Wrench, status: "coming_soon" },
  { id: "documents", title: "Document analysis", description: "Ask questions about your PDFs, sheets and reports.", icon: FileSearch, status: "available" },
  { id: "finance", title: "Financial analysis", description: "Ratios, forecasts and risk signals.", icon: BarChart3, status: "coming_soon" },
  { id: "memory", title: "Semantic memory", description: "Remembers facts you share, stored in ChromaDB.", icon: Database, status: "available" },
  { id: "voice", title: "Voice assistant", description: "Spoken conversations with NLP.", icon: Mic, status: "coming_soon" },
  { id: "reasoning", title: "Agent selection", description: "Choose specialist agents per task.", icon: BrainCircuit, status: "available" },
];

export const isFeatureAvailable = (id: string) => FEATURES.find((f) => f.id === id)?.status === "available";

/** Specialist agents served by the backend (backend/avenza/ai/agents.py); "auto" picks one per question. */
export const AGENTS = [
  { id: "auto", name: "Auto", hint: "Picks the right agent for each question", icon: Sparkles },
  { id: "general", name: "General", hint: "Complete answers with explanation", icon: Bot },
  { id: "code", name: "Code", hint: "Runnable code, reviews and explanations", icon: Code2 },
  { id: "debugging", name: "Debugging", hint: "Root cause from errors and logs, then the fix", icon: Bug },
  { id: "math", name: "Math", hint: "Worked solutions, verified answer", icon: Sigma },
  { id: "reasoning", name: "Reasoning", hint: "Step-by-step logic, comparisons, decisions", icon: BrainCircuit },
  { id: "problem", name: "Problem solving", hint: "Options, recommendation and action plan", icon: Lightbulb },
  { id: "finance", name: "Finance analyst", hint: "Figures, ratios, trends and risks", icon: BarChart3 },
  { id: "files", name: "Answer from files", hint: "Only the files attached to this chat", icon: Files },
  { id: "analyst", name: "File analysis", hint: "Deep review of PDF, Word, slides, sheets, code", icon: FileText },
  { id: "diagram", name: "Flow diagram", hint: "Flowcharts from an image, file or description", icon: Workflow },
  { id: "image", name: "Image analysis", hint: "Charts, screenshots, photos and scans", icon: ImageIcon },
  { id: "research", name: "Document research", hint: "Answers quoted from all your documents", icon: FileSearch },
] as const;

export type AgentId = (typeof AGENTS)[number]["id"];
