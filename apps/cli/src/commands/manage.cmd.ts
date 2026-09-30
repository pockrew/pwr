import { parseArgs } from "node:util";

import { agentAuthHeaders, agentPort, ensureAgentDaemonRunning } from "~/client/daemon.client";

type Resource = "collections" | "endpoints" | "secrets";
type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Only the Agent owns configuration and secrets; this client sends one local API request. */
export const callAgent = async (
  port: number,
  method: Method,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...agentAuthHeaders(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const raw: unknown = await response.json();
  const code =
    typeof raw === "object" && raw !== null && "code" in raw && typeof raw.code === "string"
      ? raw.code
      : "AGENT_ERROR";
  if (!response.ok) throw new Error(`${code} (HTTP ${response.status})`);
  return typeof raw === "object" && raw !== null && "data" in raw ? raw.data : undefined;
};

const segment = (value: string): string => encodeURIComponent(value);
const bool = (name: string, value: string | undefined): boolean | undefined => {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`--${name} must be true or false`);
};
const required = (value: string | undefined, label: string): string => {
  if (!value) throw new Error(`${label} is required`);
  return value;
};
/** Secrets must arrive through stdin, never an argument rendered in shell history. */
const readSecretStdin = async (): Promise<string> => {
  if (process.stdin.isTTY) throw new Error("Pipe the secret on stdin; do not put it in argv");
  const secret = (await Bun.stdin.text()).replace(/\r?\n$/, "");
  if (!secret) throw new Error("Secret stdin is empty");
  return secret;
};

/** Parse a management command, then forward the mutation to the Agent's existing local API. */
export const executeManageCommand = async (resource: Resource, args: string[]): Promise<void> => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      port: { type: "string" },
      cursor: { type: "string" },
      limit: { type: "string" },
      slug: { type: "string" },
      active: { type: "string" },
      path: { type: "string" },
      target: { type: "string" },
      paused: { type: "string" },
      header: { type: "string" },
      secret: { type: "string" },
      choice: { type: "string" },
    },
  });
  // `--secret -` sends the endpoint secret with its target, so the Agent commits both together
  // and held deliveries released by the new target never go out without it.
  const endpointSecret = async (): Promise<Record<string, unknown>> => {
    if (values.secret === undefined) return {};
    if (values.secret !== "-") throw new Error("Use --secret - and pipe the secret on stdin");
    const secret = await readSecretStdin();
    return { secret: { secret, ...(values.header ? { headerName: values.header } : {}) } };
  };
  const [action, tunnel, collection, endpoint] = positionals;
  const pinned = values.port === undefined ? undefined : Number(values.port);
  if (pinned !== undefined && (!Number.isInteger(pinned) || pinned < 1 || pinned > 65535))
    throw new Error("--port must be an integer between 1 and 65535");
  if (resource === "secrets" && action === "relay") {
    const relayAction = positionals[1];
    const relayTunnel = segment(required(positionals[2], "Tunnel alias"));
    const path = `/tunnels/${relayTunnel}/relay-key`;
    let method: Method;
    let body: Record<string, unknown> | undefined;
    if (relayAction === "status") method = "GET";
    else if (relayAction === "delete") method = "DELETE";
    else if (relayAction === "set") {
      method = "PUT";
      body = { apiKey: await readSecretStdin() };
    } else throw new Error("Usage: pwr secrets relay <status|set|delete> <tunnel>");
    if (!(await ensureAgentDaemonRunning(pinned)))
      throw new Error(`Agent is offline on port ${agentPort(pinned)}`);
    console.log(JSON.stringify(await callAgent(agentPort(pinned), method, path, body), null, 2));
    return;
  }
  const tunnelId = segment(required(tunnel, "Tunnel alias"));
  const collectionId = collection ? segment(collection) : undefined;
  const endpointId = endpoint ? segment(endpoint) : undefined;
  const root = `/tunnels/${tunnelId}`;
  const collectionPath = `${root}/collections/${collectionId ?? ""}`;
  const endpointPath = `${collectionPath}/endpoints/${endpointId ?? ""}`;
  const query = new URLSearchParams();
  if (values.cursor) query.set("cursor", values.cursor);
  if (values.limit) {
    const limit = Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("--limit must be an integer between 1 and 100");
    query.set("limit", String(limit));
  }
  const page = query.size ? `&${query}` : "";

  let method: Method;
  let path: string;
  let body: Record<string, unknown> | undefined;
  if (resource === "collections") {
    if (action === "list") {
      method = "GET";
      path = `${root}/config?kind=collection${page}`;
    } else if (action === "get") {
      required(collection, "Collection ID");
      method = "GET";
      path = collectionPath;
    } else if (action === "create") {
      method = "POST";
      path = `${root}/collections`;
      body = { slug: required(collection ?? values.slug, "Collection slug") };
      if (values.active !== undefined) body.isActive = bool("active", values.active);
    } else if (action === "update") {
      required(collection, "Collection ID");
      method = "PATCH";
      path = collectionPath;
      body = {};
      if (values.slug !== undefined) body.slug = values.slug;
      if (values.active !== undefined) body.isActive = bool("active", values.active);
      if (Object.keys(body).length === 0) throw new Error("Provide --slug or --active");
    } else if (action === "resolve") {
      required(collection, "Collection ID");
      method = "POST";
      path = `${root}/config/collection/${collectionId}/resolve`;
      body = { choice: required(values.choice, "--choice local|server") };
    } else throw new Error("Usage: pwr collections <list|get|create|update|resolve> <tunnel> [id]");
  } else if (resource === "endpoints") {
    if (action === "list") {
      method = "GET";
      path = `${root}/config?kind=endpoint${page}`;
    } else if (action === "get") {
      required(collection, "Collection ID");
      required(endpoint, "Endpoint ID");
      method = "GET";
      path = endpointPath;
    } else if (action === "create") {
      required(collection, "Collection ID");
      method = "POST";
      path = `${collectionPath}/endpoints`;
      body = {
        pathName: required(values.path, "--path"),
        localTarget: required(values.target, "--target"),
        ...(await endpointSecret()),
      };
      if (values.active !== undefined) body.isActive = bool("active", values.active);
      if (values.paused !== undefined) body.isPaused = bool("paused", values.paused);
    } else if (action === "update") {
      required(collection, "Collection ID");
      required(endpoint, "Endpoint ID");
      method = "PATCH";
      path = endpointPath;
      body = {};
      if (values.path !== undefined) body.pathName = values.path;
      // `--target none` clears the agent-owned target; deliveries then wait until one is set.
      if (values.target !== undefined)
        body.localTarget = values.target === "none" ? null : values.target;
      if (values.active !== undefined) body.isActive = bool("active", values.active);
      if (values.paused !== undefined) body.isPaused = bool("paused", values.paused);
      Object.assign(body, await endpointSecret());
      if (Object.keys(body).length === 0)
        throw new Error("Provide --path, --target, --secret, --active or --paused");
    } else if (action === "resolve") {
      required(endpoint, "Endpoint ID");
      method = "POST";
      path = `${root}/config/endpoint/${endpointId}/resolve`;
      body = { choice: required(values.choice, "--choice local|server") };
    } else throw new Error("Usage: pwr endpoints <list|get|create|update|resolve> <tunnel> [ids]");
  } else {
    required(collection, "Collection ID");
    required(endpoint, "Endpoint ID");
    path = `${endpointPath}/secret`;
    if (action === "status") method = "GET";
    else if (action === "delete") method = "DELETE";
    else if (action === "set") {
      method = "PUT";
      body = {
        secret: await readSecretStdin(),
        ...(values.header ? { headerName: values.header } : {}),
      };
    } else
      throw new Error("Usage: pwr secrets <status|set|delete> <tunnel> <collection> <endpoint>");
  }

  if (!(await ensureAgentDaemonRunning(pinned)))
    throw new Error(`Agent is offline on port ${agentPort(pinned)}`);
  const result = await callAgent(agentPort(pinned), method, path, body);
  console.log(JSON.stringify(result, null, 2));
};
