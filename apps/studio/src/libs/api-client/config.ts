import type {
  ConfigCollection,
  ConfigEndpoint,
  CreateCollectionInput,
  CreateLocalEndpointInput,
  LocalConfigPage,
  UpdateCollectionInput,
  UpdateLocalEndpointInput,
} from "@pockrew/pwr-shared/schemas";

import { rpc, unwrapRpc } from "./client";

/** Agent endpoint view: the replicated document plus its agent-owned target (null = unset). */
export type LocalEndpoint = ConfigEndpoint & { localTarget: string | null };

export const fetchTunnelConfig = async (
  tunnelId: string,
  query: {
    kind: "collection" | "endpoint";
    cursor?: string;
    limit?: number;
  },
): Promise<LocalConfigPage> => {
  const res = await rpc.tunnels[":tunnelId"].config.$get({
    param: { tunnelId },
    query: {
      kind: query.kind,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit !== undefined ? { limit: String(query.limit) } : {}),
    },
  });
  return await unwrapRpc(res);
};

export const createCollection = async (
  tunnelId: string,
  payload: CreateCollectionInput,
): Promise<ConfigCollection> => {
  const res = await rpc.tunnels[":tunnelId"].collections.$post({
    param: { tunnelId },
    json: payload,
  });
  return await unwrapRpc(res);
};

export const updateCollection = async (
  tunnelId: string,
  collectionId: string,
  payload: UpdateCollectionInput,
): Promise<ConfigCollection> => {
  const res = await rpc.tunnels[":tunnelId"].collections[":collectionId"].$patch({
    param: { tunnelId, collectionId },
    json: payload,
  });
  return await unwrapRpc(res);
};

export const createEndpoint = async (
  tunnelId: string,
  collectionId: string,
  payload: CreateLocalEndpointInput,
): Promise<LocalEndpoint> => {
  const res = await rpc.tunnels[":tunnelId"].collections[":collectionId"].endpoints.$post({
    param: { tunnelId, collectionId },
    json: payload,
  });
  return await unwrapRpc(res);
};

export const updateEndpoint = async (
  tunnelId: string,
  collectionId: string,
  endpointId: string,
  payload: UpdateLocalEndpointInput,
): Promise<LocalEndpoint> => {
  const res = await rpc.tunnels[":tunnelId"].collections[":collectionId"].endpoints[
    ":endpointId"
  ].$patch({
    param: { tunnelId, collectionId, endpointId },
    json: payload,
  });
  return await unwrapRpc(res);
};

export const fetchEndpointSecretStatus = async (
  tunnelId: string,
  collectionId: string,
  endpointId: string,
): Promise<{ configured: boolean; headerName: string | null }> => {
  const res = await rpc.tunnels[":tunnelId"].collections[":collectionId"].endpoints[
    ":endpointId"
  ].secret.$get({
    param: { tunnelId, collectionId, endpointId },
  });
  return await unwrapRpc(res);
};

/**
 * Settle an offline edit conflict: keep this agent's version or take the server's.
 * @throws When the record has no conflict or the agent rejects the choice.
 */
export const resolveConfigConflict = async (
  tunnelId: string,
  kind: "collection" | "endpoint",
  id: string,
  choice: "local" | "server",
): Promise<void> => {
  await unwrapRpc(
    await rpc.tunnels[":tunnelId"].config[":kind"][":id"].resolve.$post({
      param: { tunnelId, kind, id },
      json: { choice },
    }),
  );
};
