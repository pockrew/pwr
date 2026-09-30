import type {
  AgentRelayConnect,
  AgentRelayDrain,
  AgentRelayTest,
  AgentRelayTestResult,
  AgentTunnelSession,
} from "@pockrew/pwr-shared/schemas";

import { rpc, unwrapRpc } from "./client";

export const fetchTunnels = async (): Promise<{ tunnels: AgentTunnelSession[] }> => {
  const res = await rpc.tunnels.$get();
  return await unwrapRpc(res);
};

export const fetchTunnel = async (tunnelId: string): Promise<{ tunnel: AgentTunnelSession }> => {
  const res = await rpc.tunnels[":tunnelId"].$get({
    param: { tunnelId },
  });
  return await unwrapRpc(res);
};

export const connectTunnel = async (
  payload: AgentRelayConnect,
): Promise<{ tunnelId: string; status: string }> => {
  const res = await rpc.tunnels.connect.$post({
    json: payload,
  });
  return await unwrapRpc(res);
};

/** Asks the agent to check a relay key against the server; nothing is saved. */
export const testTunnelConnection = async (
  payload: AgentRelayTest,
): Promise<AgentRelayTestResult> => {
  const res = await rpc.tunnels.test.$post({ json: payload });
  return await unwrapRpc(res);
};

export const disconnectTunnel = async (
  tunnelId: string,
): Promise<{ tunnelId: string; status: string }> => {
  const res = await rpc.tunnels.disconnect.$post({
    json: { tunnelId },
  });
  return await unwrapRpc(res);
};

export const pauseTunnel = async (
  tunnelId: string,
): Promise<{ tunnelId: string; isPaused: boolean }> => {
  const res = await rpc.tunnels[":tunnelId"].pause.$post({
    param: { tunnelId },
  });
  return await unwrapRpc(res);
};

export const resumeTunnel = async (
  tunnelId: string,
  payload: AgentRelayDrain = {},
): Promise<{ tunnelId: string; isPaused: boolean; drainResult?: unknown }> => {
  const res = await rpc.tunnels[":tunnelId"].resume.$post({
    param: { tunnelId },
    json: payload,
  });
  return await unwrapRpc(res);
};

export const fetchRelayKeyStatus = async (tunnelId: string): Promise<{ configured: boolean }> => {
  const res = await rpc.tunnels[":tunnelId"]["relay-key"].$get({
    param: { tunnelId },
  });
  return await unwrapRpc(res);
};
