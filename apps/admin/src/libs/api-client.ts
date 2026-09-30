import { hc } from "hono/client";

import type { ApiType } from "@pockrew/pwr-server/rpc";
import type {
  CreateManagedTunnelInput,
  GenerateKeyInput,
  ManagedKey,
  ManagedTunnel,
  UpdateManagedTunnelInput,
} from "@pockrew/pwr-shared/schemas";

import { readData } from "./read-data";

export const rpc = hc<ApiType>("/api", {
  init: { credentials: "include" },
});

export type ServerHealth = {
  status: string;
  timestamp: number;
};

export type AuditItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  createdAt: string;
};

export type AuthUser = {
  id: string;
  email: string;
  name?: string | undefined;
  role?: string | undefined;
};

export type AuthSession = {
  user: AuthUser;
  session: {
    id: string;
    userId: string;
    expiresAt: string;
  };
};

/**
 * Server readiness: the API answers and its database is connected.
 * @throws When the server is unreachable or reports the database unavailable.
 */
export const fetchReadiness = async (): Promise<ServerHealth> => {
  const res = await fetch("/api/ready", { credentials: "include" });
  const data = await readData<{ status: string; timestamp: number }>(res, "Server not ready");
  return { status: data.status, timestamp: data.timestamp };
};

/**
 * List managed tunnels from server.
 */
export const fetchTunnels = async (): Promise<ManagedTunnel[]> => {
  const items: ManagedTunnel[] = [];
  let cursor: string | undefined;
  do {
    const res = await rpc.tunnels.$get({
      query: { limit: "100", ...(cursor ? { cursor } : {}) },
    });
    const page = await readData(res, "Failed to fetch tunnels");
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
};

export const createTunnel = async (input: CreateManagedTunnelInput): Promise<ManagedTunnel> => {
  const res = await rpc.tunnels.$post({
    json: input,
  });
  return readData(res, "Failed to create tunnel");
};

/**
 * Update an existing managed tunnel.
 */
export const updateTunnel = async (
  tunnelId: string,
  input: UpdateManagedTunnelInput,
): Promise<ManagedTunnel> => {
  const res = await rpc.tunnels[":tunnelId"].$patch({
    param: { tunnelId },
    json: input,
  });
  return readData(res, "Failed to update tunnel");
};

/**
 * Delete / soft-revoke a managed tunnel.
 */
export const deleteTunnel = async (tunnelId: string): Promise<ManagedTunnel> => {
  const res = await rpc.tunnels[":tunnelId"].$delete({
    param: { tunnelId },
  });
  return readData(res, "Failed to delete tunnel");
};

/**
 * List credentials/keys for a specific tunnel.
 */
export const fetchTunnelKeys = async (tunnelId: string): Promise<ManagedKey[]> => {
  const items: ManagedKey[] = [];
  let cursor: string | undefined;
  do {
    const res = await rpc.tunnels[":tunnelId"].keys.$get({
      param: { tunnelId },
      query: { limit: "100", ...(cursor ? { cursor } : {}) },
    });
    const page = await readData(res, "Failed to fetch keys");
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
};

export const generateTunnelKey = async (
  tunnelId: string,
  input: GenerateKeyInput,
): Promise<{ key: ManagedKey; token: string }> => {
  const res = await rpc.tunnels[":tunnelId"].keys.$post({
    param: { tunnelId },
    json: input,
  });
  return readData(res, "Failed to generate key");
};

/**
 * Revoke an existing key.
 */
export const revokeTunnelKey = async (tunnelId: string, keyId: string): Promise<void> => {
  const res = await rpc.tunnels[":tunnelId"].keys[":keyId"].$delete({
    param: { tunnelId, keyId },
  });
  await readData(res, "Failed to revoke key");
};

/**
 * One page of audit records, newest first; pass the previous page's `nextCursor` for older ones.
 */
export const fetchAuditPage = async (
  cursor?: string,
): Promise<{ items: AuditItem[]; nextCursor: string | null }> => {
  const params = new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : {}) });
  const res = await fetch(`/api/audit?${params}`, { credentials: "include" });
  return readData<{ items: AuditItem[]; nextCursor: string | null }>(
    res,
    "Failed to load audit records",
  );
};

/**
 * Get active Better Auth session.
 */
export const fetchSession = async (): Promise<AuthSession | null> => {
  try {
    const res = await fetch("/api/auth/get-session", { credentials: "include" });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    if (typeof json === "object" && json !== null && "user" in json && "session" in json) {
      const u = json.user;
      const s = json.session;
      if (
        typeof u === "object" &&
        u !== null &&
        "id" in u &&
        "email" in u &&
        typeof s === "object" &&
        s !== null &&
        "id" in s &&
        "userId" in s &&
        "expiresAt" in s
      ) {
        return {
          user: {
            id: String(u.id),
            email: String(u.email),
            name: "name" in u ? String(u.name) : undefined,
            role: "role" in u ? String(u.role) : undefined,
          },
          session: {
            id: String(s.id),
            userId: String(s.userId),
            expiresAt: String(s.expiresAt),
          },
        };
      }
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Sign in with email and password via Better Auth.
 */
export const signInWithPassword = async (email: string, password: string): Promise<void> => {
  const res = await fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  await readData(res, "Invalid credentials");
};

/**
 * Sign out of current session.
 */
export const signOutSession = async (): Promise<void> => {
  await fetch("/api/auth/sign-out", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({}),
  }).catch(() => {});
};
