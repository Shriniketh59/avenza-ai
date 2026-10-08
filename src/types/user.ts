export type AuthProvider = "credentials" | "google";

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  provider: AuthProvider;
  createdAt?: string | null;
}

export interface Session {
  user: User;
  /** Opaque access token issued by the Flask backend, if any. Server-side only. */
  backendToken?: string | null;
  expiresAt: number;
}
