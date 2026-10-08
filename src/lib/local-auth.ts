"use client";

import { ApiError } from "@/lib/api-error";
import { LOCAL_SESSION_COOKIE, encodeLocalSession } from "@/lib/local-session";
import { createId } from "@/lib/utils";
import type { User } from "@/types/user";

/**
 * Preview-mode accounts, stored only in this browser (localStorage).
 * Passwords are salted + hashed (PBKDF2) so they are never stored in plain
 * text, but this is not a substitute for server-side auth. Replaced
 * automatically once FLASK_API_URL is configured.
 */

interface LocalAccount {
  user: User;
  salt: string;
  hash: string;
}

const ACCOUNTS_KEY = "avenza.preview.accounts";
const SHORT = 60 * 60 * 12;
const LONG = 60 * 60 * 24 * 30;

function loadAccounts(): Record<string, LocalAccount> {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveAccounts(accounts: Record<string, LocalAccount>) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

const toHex = (buf: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

async function hashPassword(password: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 210_000 }, key, 256);
  return toHex(bits);
}

function setSessionCookie(user: User, remember: boolean) {
  const ttl = remember ? LONG : SHORT;
  const value = encodeURIComponent(encodeLocalSession(user, Date.now() + ttl * 1000));
  document.cookie = `${LOCAL_SESSION_COOKIE}=${value}; path=/; SameSite=Lax${remember ? `; max-age=${ttl}` : ""}`;
}

function clearSessionCookie() {
  document.cookie = `${LOCAL_SESSION_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

const normalize = (email: string) => email.trim().toLowerCase();

export const localAuth = {
  async signup(input: { name: string; email: string; password: string }): Promise<{ user: User }> {
    const accounts = loadAccounts();
    const email = normalize(input.email);
    if (accounts[email]) throw new ApiError("An account with this email already exists.", 409, undefined, { email: "Email already registered" });
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const user: User = { id: createId("user"), name: input.name.trim(), email, provider: "credentials", avatarUrl: null, createdAt: new Date().toISOString() };
    accounts[email] = { user, salt, hash: await hashPassword(input.password, salt) };
    saveAccounts(accounts);
    setSessionCookie(user, false);
    return { user };
  },

  async login(input: { email: string; password: string; remember?: boolean }): Promise<{ user: User }> {
    const account = loadAccounts()[normalize(input.email)];
    const ok = account && (await hashPassword(input.password, account.salt)) === account.hash;
    if (!ok) throw new ApiError("Invalid email or password.", 401);
    setSessionCookie(account.user, Boolean(input.remember));
    return { user: account.user };
  },

  async forgotPassword(): Promise<{ ok: true }> {
    throw new ApiError("Password reset emails need the AVENZA backend. In preview mode, create a new account instead.", 503, "PREVIEW_MODE");
  },

  async logout(): Promise<{ ok: true }> {
    clearSessionCookie();
    return { ok: true };
  },

  async updateProfile(input: { name: string }, current: User): Promise<{ user: User }> {
    const accounts = loadAccounts();
    const account = accounts[normalize(current.email)];
    if (!account) throw new ApiError("Account not found in this browser.", 404);
    account.user = { ...account.user, name: input.name.trim() };
    saveAccounts(accounts);
    setSessionCookie(account.user, true);
    return { user: account.user };
  },
};
