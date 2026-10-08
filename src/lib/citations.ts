// "[1]", "[3, 7]", "[1-2]", and runs like "[1], [5]" — but not Markdown links "[1](url)".
const MARKER = String.raw`\[\d+(?:\s*[,–-]\s*\d+)*\](?!\()`;
const CITATIONS = new RegExp(String.raw`[ \t]*${MARKER}(?:\s*,?\s*${MARKER})*`, "g");
// A marker cut off mid-stream ("... 5.5% [", "... [3, ").
const PARTIAL = /[ \t]*\[\d*(?:\s*[,–-]\s*\d*)*$/;

/** Remove inline source numbers from an answer, leaving code untouched. */
export function stripCitations(text: string, streaming = false): string {
  const parts = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/);
  const out = parts.map((part, i) => (i % 2 === 1 ? part : part.replace(CITATIONS, ""))).join("");
  return streaming ? out.replace(PARTIAL, "") : out;
}
