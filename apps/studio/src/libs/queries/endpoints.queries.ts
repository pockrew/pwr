import { createMutation, createQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";

import type {
  ConfigCollection,
  ConfigEndpoint,
  CreateLocalEndpointInput,
  LocalConfigEntry,
  LocalConfigPage,
  UpdateCollectionInput,
  UpdateLocalEndpointInput,
} from "@pockrew/pwr-shared/schemas";

import {
  createCollection,
  createEndpoint,
  fetchEndpointSecretStatus,
  fetchTunnelConfig,
  resolveConfigConflict,
  updateCollection,
  updateEndpoint,
} from "~/libs/api-client";
import { queryClient } from "~/libs/query-client";

/** Sync state of a record edited on this agent: waiting to reach the server, or in conflict. */
interface SyncState<T> {
  /** Local change not yet accepted by the server. */
  pending: boolean;
  /** Both sides changed it offline; `remote` is the server's version until resolved. */
  hasConflict: boolean;
  remote: T | null;
}

export interface CollectionItem extends SyncState<ConfigCollection> {
  id: string;
  slug: string;
  isActive: boolean;
}

export interface EndpointItem extends SyncState<ConfigEndpoint> {
  id: string;
  collectionId: string;
  pathName: string;
  /** Agent-owned target; null means deliveries wait until one is set. */
  localTarget: string | null;
  isActive: boolean;
  isPaused: boolean;
  /** Target secret stored in the agent (never its value), added as a header on target calls. */
  secret: { configured: boolean; headerName: string | null };
}

export interface CollectionsData {
  items: CollectionItem[];
  /** `<server>/ingress/<tunnel slug>`; null until the tunnel has synced with its server. */
  ingressBaseUrl: string | null;
  sync: LocalConfigPage["sync"];
}

export const endpointKeys = {
  all: ["tunnels"] as const,
  collections: (tunnelId: string) => ["tunnels", tunnelId, "collections"] as const,
  endpoints: (tunnelId: string) => ["tunnels", tunnelId, "endpoints"] as const,
};

const syncState = <T>(entry: LocalConfigEntry, remote: T | null): SyncState<T> => ({
  pending: entry.pending,
  hasConflict: entry.hasConflict,
  remote,
});

/** Every config record of one kind, following the agent's pages. */
const fetchAllConfig = async (tunnelId: string, kind: "collection" | "endpoint") => {
  const items: LocalConfigEntry[] = [];
  let cursor: string | undefined;
  let sync: LocalConfigPage["sync"] = null;
  do {
    const page = await fetchTunnelConfig(tunnelId, {
      kind,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    items.push(...page.items);
    sync = page.sync;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return { items, sync };
};

/** Collections of a tunnel as stored by the agent, with their sync state. */
export const createCollectionsQuery = (tunnelId: Accessor<string>) =>
  createQuery(
    () => ({
      queryKey: endpointKeys.collections(tunnelId()),
      queryFn: async (): Promise<CollectionsData> => {
        const tid = tunnelId();
        if (!tid) return { items: [], ingressBaseUrl: null, sync: null };
        const { items, sync } = await fetchAllConfig(tid, "collection");
        return {
          items: items.flatMap((entry) =>
            entry.value.kind === "collection" && !entry.value.deleted
              ? [
                  {
                    id: entry.value.id,
                    slug: entry.value.slug ?? "",
                    isActive: entry.value.isActive,
                    ...syncState(entry, entry.remote?.kind === "collection" ? entry.remote : null),
                  },
                ]
              : [],
          ),
          ingressBaseUrl: sync
            ? `${sync.serverUrl}/ingress/${encodeURIComponent(sync.slug)}`
            : null,
          sync,
        };
      },
      enabled: Boolean(tunnelId()),
    }),
    () => queryClient,
  );

/** Endpoints of a tunnel with their agent-owned targets and target-secret status. */
export const createEndpointsQuery = (tunnelId: Accessor<string>) =>
  createQuery(
    () => ({
      queryKey: endpointKeys.endpoints(tunnelId()),
      queryFn: async (): Promise<EndpointItem[]> => {
        const tid = tunnelId();
        if (!tid) return [];
        const { items } = await fetchAllConfig(tid, "endpoint");
        const endpoints = items.flatMap((entry) =>
          entry.value.kind === "endpoint" && !entry.value.deleted
            ? [{ entry, doc: entry.value }]
            : [],
        );
        return Promise.all(
          endpoints.map(async ({ entry, doc }) => ({
            id: doc.id,
            collectionId: doc.collectionId,
            pathName: doc.pathName,
            localTarget: entry.localTarget,
            isActive: doc.isActive,
            isPaused: doc.isPaused,
            secret: await fetchEndpointSecretStatus(tid, doc.collectionId, doc.id),
            ...syncState(entry, entry.remote?.kind === "endpoint" ? entry.remote : null),
          })),
        );
      },
      enabled: Boolean(tunnelId()),
    }),
    () => queryClient,
  );

const invalidateConfig = (tunnelId: string) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: endpointKeys.collections(tunnelId) }),
    queryClient.invalidateQueries({ queryKey: endpointKeys.endpoints(tunnelId) }),
  ]);

/** Create a collection on the agent (synced to the server when connected). */
export const createCollectionMutation = (tunnelId: Accessor<string>) =>
  createMutation(
    () => ({
      mutationFn: (input: { slug: string; isActive: boolean }) =>
        createCollection(tunnelId(), input),
      onSuccess: () => invalidateConfig(tunnelId()),
    }),
    () => queryClient,
  );

/** Change a collection's slug or active state. */
export const updateCollectionMutation = (tunnelId: Accessor<string>) =>
  createMutation(
    () => ({
      mutationFn: ({ id, input }: { id: string; input: UpdateCollectionInput }) =>
        updateCollection(tunnelId(), id, input),
      onSuccess: () => invalidateConfig(tunnelId()),
    }),
    () => queryClient,
  );

/** Create an endpoint; its target and secret commit in the same agent request. */
export const createEndpointMutation = (tunnelId: Accessor<string>) =>
  createMutation(
    () => ({
      mutationFn: ({
        collectionId,
        input,
      }: {
        collectionId: string;
        input: CreateLocalEndpointInput;
      }) => createEndpoint(tunnelId(), collectionId, input),
      onSuccess: () => invalidateConfig(tunnelId()),
    }),
    () => queryClient,
  );

/** Update an endpoint; a new target and secret commit together (`secret: null` removes it). */
export const updateEndpointMutation = (tunnelId: Accessor<string>) =>
  createMutation(
    () => ({
      mutationFn: ({
        id,
        collectionId,
        input,
      }: {
        id: string;
        collectionId: string;
        input: UpdateLocalEndpointInput;
      }) => updateEndpoint(tunnelId(), collectionId, id, input),
      onSuccess: () => invalidateConfig(tunnelId()),
    }),
    () => queryClient,
  );

/** Keep this agent's version of a conflicting record, or take the server's. */
export const resolveConflictMutation = (tunnelId: Accessor<string>) =>
  createMutation(
    () => ({
      mutationFn: ({
        kind,
        id,
        choice,
      }: {
        kind: "collection" | "endpoint";
        id: string;
        choice: "local" | "server";
      }) => resolveConfigConflict(tunnelId(), kind, id, choice),
      onSuccess: () => invalidateConfig(tunnelId()),
    }),
    () => queryClient,
  );
