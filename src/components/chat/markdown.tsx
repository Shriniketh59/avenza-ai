"use client";

import { memo, isValidElement, type ReactElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./code-block";
import { MermaidDiagram } from "./mermaid-diagram";

/** Plain text of rendered Markdown children (code may arrive wrapped in highlight spans). */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="prose-avenza">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre({ children }) {
            const child = isValidElement(children) ? (children as ReactElement<{ className?: string; children?: React.ReactNode }>) : null;
            const lang = /language-([\w-]+)/.exec(child?.props.className ?? "")?.[1] ?? null;
            if (lang === "mermaid") return <MermaidDiagram code={textOf(child?.props.children).trim()} />;
            return <CodeBlock language={lang}>{child ?? children}</CodeBlock>;
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto">
                <table>{children}</table>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
