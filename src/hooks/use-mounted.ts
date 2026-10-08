"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** True only on the client after hydration. */
export function useMounted(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
