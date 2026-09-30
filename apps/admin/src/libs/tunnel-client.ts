import type {
  DeliveryBacklogStatus,
  IngressSigningStatus,
  ManagedCollection,
  ManagedEndpoint,
  SetIngressSigningInput,
} from "@pockrew/pwr-shared/schemas";

import { rpc } from "./api-client";
import { readData } from "./read-data";

/** Ingress authentication of a tunnel: the scoped API key, or a provider signature. */
export type IngressAuth = IngressSigningStatus;

/** Follow an ID-cursor list to the end (management pages hold at most 100 items). */
const allPages = async <T>(
  page: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<T[]> => {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const next = await page(cursor);
    items.push(...next.items);
    cursor = next.nextCursor ?? undefined;
  } while (cursor);
  return items;
};

const pageQuery = (cursor?: string) => ({ limit: "100", ...(cursor ? { cursor } : {}) });

export const fetchCollections = (tunnelId: string): Promise<ManagedCollection[]> =>
  allPages(async (cursor) =>
    readData(
      await rpc.tunnels[":tunnelId"].collections.$get({
        param: { tunnelId },
        query: pageQuery(cursor),
      }),
      "Failed to load collections",
    ),
  );

export const fetchEndpoints = (
  tunnelId: string,
  collectionId: string,
): Promise<ManagedEndpoint[]> =>
  allPages(async (cursor) =>
    readData(
      await rpc.tunnels[":tunnelId"].collections[":collectionId"].endpoints.$get({
        param: { tunnelId, collectionId },
        query: pageQuery(cursor),
      }),
      "Failed to load endpoints",
    ),
  );

export const updateCollection = async (
  tunnelId: string,
  collectionId: string,
  input: { isActive: boolean },
): Promise<ManagedCollection> =>
  readData(
    await rpc.tunnels[":tunnelId"].collections[":collectionId"].$patch({
      param: { tunnelId, collectionId },
      json: input,
    }),
    "Failed to update the collection",
  );

export const deleteCollection = async (tunnelId: string, collectionId: string): Promise<void> => {
  await readData(
    await rpc.tunnels[":tunnelId"].collections[":collectionId"].$delete({
      param: { tunnelId, collectionId },
    }),
    "Failed to delete the collection",
  );
};

export const updateEndpoint = async (
  tunnelId: string,
  collectionId: string,
  endpointId: string,
  input: { isActive?: boolean; isPaused?: boolean },
): Promise<ManagedEndpoint> =>
  readData(
    await rpc.tunnels[":tunnelId"].collections[":collectionId"].endpoints[":endpointId"].$patch({
      param: { tunnelId, collectionId, endpointId },
      json: input,
    }),
    "Failed to update the endpoint",
  );

export const deleteEndpoint = async (
  tunnelId: string,
  collectionId: string,
  endpointId: string,
): Promise<void> => {
  await readData(
    await rpc.tunnels[":tunnelId"].collections[":collectionId"].endpoints[":endpointId"].$delete({
      param: { tunnelId, collectionId, endpointId },
    }),
    "Failed to delete the endpoint",
  );
};

export const fetchIngressAuth = async (tunnelId: string): Promise<IngressAuth> =>
  readData(
    await rpc.tunnels[":tunnelId"]["ingress-signing"].$get({ param: { tunnelId } }),
    "Failed to load ingress authentication",
  );

export const setIngressSigning = async (
  tunnelId: string,
  input: SetIngressSigningInput,
): Promise<IngressAuth> =>
  readData(
    await rpc.tunnels[":tunnelId"]["ingress-signing"].$put({ param: { tunnelId }, json: input }),
    "Failed to save the signing secret",
  );

export const removeIngressSigning = async (tunnelId: string): Promise<IngressAuth> =>
  readData(
    await rpc.tunnels[":tunnelId"]["ingress-signing"].$delete({ param: { tunnelId } }),
    "Failed to switch back to API keys",
  );

export const fetchDeliveryStatus = async (tunnelId: string): Promise<DeliveryBacklogStatus> =>
  readData(
    await rpc.tunnels[":tunnelId"]["delivery-status"].$get({ param: { tunnelId } }),
    "Failed to load delivery status",
  );
