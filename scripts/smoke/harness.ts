/**
 * Process/HTTP helpers for `scripts/smoke.ts`: a real server and agents on temporary databases and
 * spare ports, plus a recording local target. Nothing here touches a user's data directory.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const REPO = join(import.meta.dir, "..", "..");

/** Narrow unknown JSON without casts: follows object keys, returns undefined when absent. */
export const pick = (value: unknown, ...path: string[]): unknown => {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) return undefined;
    current = Reflect.get(current, key);
  }
  return current;
};
export const str = (value: unknown): string => (typeof value === "string" ? value : "");
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Pass/fail reporter; the process exit code reflects the total. */
export const createChecks = () => {
  let failures = 0;
  return {
    check: (name: string, ok: boolean, detail = ""): void => {
      if (!ok) failures += 1;
      console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
    },
    fail: (name: string, error: unknown): void => {
      failures += 1;
      console.log(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
    },
    failures: (): number => failures,
  };
};

/** Poll a condition; errors count as "not yet". Bounded so a broken flow fails instead of hanging. */
export const until = async (
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 15_000,
): Promise<boolean> => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      if (await condition()) return true;
    } catch {
      // Not ready yet.
    }
    await Bun.sleep(100);
  }
  return false;
};

export type TargetHit = {
  path: string;
  query: string;
  headers: Record<string, string>;
  body: Buffer;
};

/** Local target that records every request byte-for-byte and answers with a settable status. */
export const startTarget = (port: number) => {
  const hits: TargetHit[] = [];
  let status = 200;
  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: async (req) => {
      hits.push({
        path: new URL(req.url).pathname,
        query: new URL(req.url).search.slice(1),
        headers: Object.fromEntries(req.headers),
        body: Buffer.from(await req.arrayBuffer()),
      });
      return new Response("target ok", { status });
    },
  });
  return {
    hits,
    bodies: (text: string): number => hits.filter((h) => h.body.toString() === text).length,
    setStatus: (next: number): void => {
      status = next;
    },
    stop: (): void => {
      void server.stop(true);
    },
  };
};

/** Spawns repo entry points with an explicit environment and a temp cwd (no `.env` pickup). */
export const createProcesses = (root: string) => {
  const procs = new Map<string, ReturnType<typeof Bun.spawn>>();
  const spawn = (name: string, entry: string, cwd: string, env: Record<string, string>): void => {
    mkdirSync(cwd, { recursive: true });
    procs.set(
      name,
      Bun.spawn(["bun", join(REPO, entry)], {
        cwd,
        env: { PATH: process.env["PATH"] ?? "", HOME: cwd, ...env },
        stdout: Bun.file(join(cwd, `${name}.log`)),
        stderr: Bun.file(join(cwd, `${name}.err.log`)),
      }),
    );
  };
  return {
    server: (port: number, publicUrl: string): void =>
      spawn("server", "apps/server/src/index.ts", join(root, "server"), {
        NODE_ENV: "development",
        PORT: String(port),
        PUBLIC_URL: publicUrl,
        DB_FILE_NAME: join(root, "server", "server.sqlite"),
        BETTER_AUTH_SECRET: "smoke-secret-smoke-secret-smoke-secret-0123",
        ADMIN_EMAIL: "smoke@example.com",
        ADMIN_PASSWORD: "smoke-password-123",
        RELAY_ACK_TIMEOUT_MS: "5000",
        WEBHOOK_SIGNING_ENCRYPTION_KEY: "ab".repeat(32),
      }),
    agent: (name: string, port: number): void => {
      const home = join(root, name);
      mkdirSync(join(home, ".pockrew"), { recursive: true });
      spawn(name, "apps/agent/src/index.ts", home, {
        NODE_ENV: "development",
        PWR_AGENT_PORT: String(port),
        AGENT_DB_FILE_NAME: join(home, ".pockrew", "agent.db"),
      });
    },
    stop: async (name: string): Promise<void> => {
      const proc = procs.get(name);
      if (!proc) return;
      proc.kill("SIGTERM");
      await proc.exited;
      procs.delete(name);
    },
    stopAll: async (): Promise<void> => {
      await Promise.all(
        [...procs.values()].map(async (proc) => {
          proc.kill("SIGTERM");
          await proc.exited;
        }),
      );
      procs.clear();
    },
  };
};

/** JSON client returning `{ status, data }` from the shared `{ data, requestId }` envelope. */
export const jsonClient =
  (base: string, headers: Record<string, string>) =>
  async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown }> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...headers, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json: unknown = await res.json().catch(() => null);
    return { status: res.status, data: pick(json, "data") };
  };
