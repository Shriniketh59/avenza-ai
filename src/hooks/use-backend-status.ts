"use client";

import { useEffect, useState } from "react";
import { systemApi, type BackendHealth } from "@/lib/api-client";

export type BackendStatus = "checking" | BackendHealth;

export function useBackendStatus(intervalMs = 30_000): BackendStatus {
  const [status, setStatus] = useState<BackendStatus>("checking");
  useEffect(() => {
    let alive = true;
    const check = () =>
      systemApi
        .health()
        .then((r) => alive && setStatus(r.backend))
        .catch(() => alive && setStatus("offline"));
    check();
    const id = setInterval(check, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);
  return status;
}
