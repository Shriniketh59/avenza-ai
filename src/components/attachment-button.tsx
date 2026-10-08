"use client";

import { Paperclip } from "lucide-react";
import { useRef } from "react";

export const ACCEPTED_FILES = [
  ".pdf,.docx,.pptx,.xlsx,.csv,.tsv,.txt,.md,.json,.html,.htm,.xml,.yaml,.yml,.log,.sql",
  ".py,.js,.ts,.tsx,.jsx,.java,.c,.cpp,.h,.cs,.go,.rs,.rb,.php,.sh,.css,.kt,.swift,.r",
  ".png,.jpg,.jpeg,.webp,.gif",
].join(",");
const MAX_FILES = 5;
const MAX_SIZE = 20 * 1024 * 1024;

/** File picker for the composer; the composer uploads + indexes the picked files. */
export function AttachmentButton({
  disabled,
  current,
  onPick,
  onError,
}: {
  disabled?: boolean;
  current: number;
  onPick: (files: File[]) => void;
  onError: (message: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        multiple
        hidden
        accept={ACCEPTED_FILES}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (current + files.length > MAX_FILES) return onError(`You can attach up to ${MAX_FILES} files at once.`);
          const tooBig = files.find((f) => f.size > MAX_SIZE);
          if (tooBig) return onError(`${tooBig.name} is larger than 20 MB.`);
          onPick(files);
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => ref.current?.click()}
        aria-label="Attach files"
        title="Attach images, PDF, Word, PowerPoint, Excel, CSV, code or text"
        className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
      >
        <Paperclip className="size-[18px]" />
      </button>
    </>
  );
}
