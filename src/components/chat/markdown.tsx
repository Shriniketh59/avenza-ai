"use client";

import { memo, isValidElement, type ReactElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { CodeBlock } from "./code-block";
import { MermaidDiagram } from "./mermaid-diagram";

/** Plain text of rendered Markdown children (code may arrive wrapped in highlight spans). */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/**
 * Math is written as \( inline \) and \[ display \] LaTeX, and single $ stays a currency sign ("$100 and $200").
 * remark-math reads $$x$$ inside a line as inline math and $$ on its own lines as a display block, so the
 * delimiters are rewritten to those, outside code. A display block left open mid-stream is not rewritten yet.
 * A model that still writes $x^2$ gets it rendered when the inside clearly is math (a command, ^, _ or =,
 * not starting with a digit), which leaves prices alone.
 */
function mathDelimiters(md: string): string {
  return md
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .map((part, i) =>
      i % 2
        ? part
        : part
            // Keeps the indent of the line it starts on, so a block inside a list item stays in that item.
            .replace(/^([ \t]*)(.*?)\\\[([\s\S]+?)\\\]/gm, (_, indent: string, before: string, m: string) =>
              `${indent}${before}\n${indent}$$\n${indent}${m.trim().replace(/\n\s*/g, " ")}\n${indent}$$\n`,
            )
            .replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => `$$${m.trim()}$$`)
            .replace(/(?<![$\\\w])\$(?![\s\d$])([^$\n]*?[\\^_=][^$\n]*?)(?<!\s)\$(?![$\w])/g, (_, m: string) => `$$${m}$$`),
    )
    .join("");
}

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="prose-avenza">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
        rehypePlugins={[
          [rehypeKatex, { throwOnError: false, strict: "ignore" }],
          [rehypeHighlight, { detect: true, ignoreMissing: true }],
        ]}
        components={{
          pre({ children }) {
            const child = isValidElement(children) ? (children as ReactElement<{ className?: string; children?: React.ReactNode }>) : null;
            const lang = /language-([\w-]+)/.exec(child?.props.className ?? "")?.[1] ?? null;
            if (lang === "mermaid") return <MermaidDiagram code={textOf(child?.props.children).trim()} />;
            return <CodeBlock language={lang}>{child ?? children}</CodeBlock>;
          },
          a({ href, children }) {
            // A generated document: a download button, not a new tab. Only real file ids (added by the app);
            // a file link the model wrote itself points nowhere, so it is shown as plain text.
            if (href?.startsWith("/api/files/") && !/^\/api\/files\/[a-f0-9]{32}$/.test(href)) return <span>{children}</span>;
            if (href?.startsWith("/api/files/")) {
              return (
                <a
                  href={href}
                  download
                  className="not-prose inline-flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3.5 py-2 text-sm font-medium text-foreground no-underline hover:bg-accent/20"
                >
                  {children}
                </a>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          img({ src, alt }) {
            if (typeof src !== "string") return null;
            return (
              <span className="my-2 block">
                {/* eslint-disable-next-line @next/next/no-img-element -- generated images are served from our own API */}
                <img src={src} alt={alt ?? ""} loading="lazy" className="max-h-[512px] max-w-full rounded-xl border border-border" />
                {src.startsWith("/api/images/") && (
                  <a href={src} download={`avenza-${src.split("/").pop()}.png`} className="mt-1 inline-block text-xs text-muted hover:text-foreground">
                    Download image
                  </a>
                )}
              </span>
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
        {mathDelimiters(content)}
      </ReactMarkdown>
    </div>
  );
});
