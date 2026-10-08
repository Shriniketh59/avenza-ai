"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keeps a scroll container pinned to the bottom while content grows,
 * unless the user has scrolled up to read.
 */
export function useAutoScroll<T extends HTMLElement>(dep: unknown, enabled: boolean) {
  const ref = useRef<T>(null);
  const [atBottom, setAtBottom] = useState(true);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    if (enabled && atBottom) scrollToBottom(false);
  }, [dep, enabled, atBottom, scrollToBottom]);

  return { ref, onScroll, atBottom, scrollToBottom };
}
