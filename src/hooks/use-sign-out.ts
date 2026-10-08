"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { authApi } from "@/lib/api-client";

export function useSignOut() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const signOut = useCallback(async () => {
    setPending(true);
    try {
      await authApi.logout();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }, [router]);
  return { signOut, pending };
}
