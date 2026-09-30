import type { ProxyConfig } from "@pockrew/pwr-shared/schemas";

import { rpc, unwrapRpc } from "./client";

/** Proxy variables found in the agent's environment (used by `auto` mode). */
export interface ISystemProxyDetected {
  httpProxy?: string;
  httpsProxy?: string;
  allProxy?: string;
  noProxy?: string;
  caCertPath?: string;
}

export interface IProxySettingsResponse {
  config: ProxyConfig;
  detected: ISystemProxyDetected;
}

/**
 * The agent's saved proxy settings and what it detects in its environment.
 * @throws When the agent is unreachable or answers with an error.
 */
export const fetchProxySettings = async (): Promise<IProxySettingsResponse> =>
  unwrapRpc(await rpc.proxy.$get());

/**
 * Save proxy settings to the agent's config.toml.
 * @returns The settings the agent stored.
 * @throws When the agent rejects or cannot store them.
 */
export const saveProxySettings = async (payload: ProxyConfig): Promise<ProxyConfig> =>
  (await unwrapRpc(await rpc.proxy.$post({ json: payload }))).proxy;
