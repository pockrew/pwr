import { createEffect, createMemo, createRoot, createSignal } from "solid-js";
import { toast } from "solid-sonner";

import type {
  CreateLocalEndpointInput,
  UpdateLocalEndpointInput,
} from "@pockrew/pwr-shared/schemas";

import {
  createCollectionMutation,
  createCollectionsQuery,
  createEndpointMutation,
  createEndpointsQuery,
  resolveConflictMutation,
  updateCollectionMutation,
  updateEndpointMutation,
  type CollectionItem,
  type EndpointItem,
} from "~/libs/queries/endpoints.queries";
import { tunnelStore } from "~/stores/tunnel.store";

export type { CollectionItem, EndpointItem };

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/**
 * Collections and endpoints of the selected tunnel as the agent stores them. Every action
 * reports success only after the agent committed it, then re-reads the agent's state.
 */
export const endpointsStore = createRoot(() => {
  const [selectedCollectionId, setSelectedCollectionId] = createSignal("");
  const [collectionFilter, setCollectionFilter] = createSignal("");
  const [endpointFilter, setEndpointFilter] = createSignal("");

  const tunnelId = () => tunnelStore.tunnelId;
  const collectionsQuery = createCollectionsQuery(tunnelId);
  const endpointsQuery = createEndpointsQuery(tunnelId);
  const createColMut = createCollectionMutation(tunnelId);
  const updateColMut = updateCollectionMutation(tunnelId);
  const createEpMut = createEndpointMutation(tunnelId);
  const updateEpMut = updateEndpointMutation(tunnelId);
  const resolveMut = resolveConflictMutation(tunnelId);

  const collections = () => collectionsQuery.data?.items ?? [];
  const endpoints = () => endpointsQuery.data ?? [];

  // Keep a valid selection when the agent's collections change.
  createEffect(() => {
    const cols = collections();
    if (cols.length && !cols.some((c) => c.id === selectedCollectionId())) {
      const first = cols[0];
      if (first) setSelectedCollectionId(first.id);
    }
  });

  const selectedCollection = createMemo(
    () => collections().find((c) => c.id === selectedCollectionId()) ?? collections()[0] ?? null,
  );

  const selectedCollectionEndpoints = createMemo(() => {
    const current = selectedCollection();
    if (!current) return [];
    const list = endpoints().filter((e) => e.collectionId === current.id);
    const q = endpointFilter().toLowerCase().trim();
    if (!q) return list;
    return list.filter(
      (e) =>
        e.pathName.toLowerCase().includes(q) || (e.localTarget ?? "").toLowerCase().includes(q),
    );
  });

  const filteredCollections = createMemo(() => {
    const q = collectionFilter().toLowerCase().trim();
    if (!q) return collections();
    return collections().filter((c) => c.slug.toLowerCase().includes(q));
  });

  const updateEndpointState = async (ep: EndpointItem, input: UpdateLocalEndpointInput) => {
    await updateEpMut.mutateAsync({ id: ep.id, collectionId: ep.collectionId, input });
  };

  return {
    /** `<server>/ingress/<tunnel slug>`, or null before the tunnel synced with its server. */
    get ingressBaseUrl() {
      return collectionsQuery.data?.ingressBaseUrl ?? null;
    },
    /** The agent's last config sync with the server, including its error if any. */
    get sync() {
      return collectionsQuery.data?.sync ?? null;
    },
    /** Error from the last agent read, shown instead of an empty list. */
    get loadError() {
      const error = collectionsQuery.error ?? endpointsQuery.error;
      return error instanceof Error ? error.message : null;
    },
    get collections() {
      return collections();
    },
    get endpoints() {
      return endpoints();
    },
    get selectedCollectionId() {
      return selectedCollectionId();
    },
    get selectedCollection() {
      return selectedCollection();
    },
    get selectedCollectionEndpoints() {
      return selectedCollectionEndpoints();
    },
    get filteredCollections() {
      return filteredCollections();
    },
    get collectionFilter() {
      return collectionFilter();
    },
    setCollectionFilter,
    get endpointFilter() {
      return endpointFilter();
    },
    setEndpointFilter,
    setSelectedCollectionId,

    get isSyncing() {
      return collectionsQuery.isFetching || endpointsQuery.isFetching;
    },
    refetch: async () => {
      await Promise.all([collectionsQuery.refetch(), endpointsQuery.refetch()]);
    },

    createCollection: async (input: { slug: string; isActive: boolean }) => {
      try {
        const created = await createColMut.mutateAsync(input);
        setSelectedCollectionId(created.id);
        toast.success(`Created collection "${created.slug ?? input.slug}"`);
        return true;
      } catch (error) {
        toast.error(errorText(error, "Failed to create the collection"));
        return false;
      }
    },

    updateCollection: async (id: string, input: { slug?: string; isActive?: boolean }) => {
      try {
        await updateColMut.mutateAsync({ id, input });
        toast.success("Collection updated");
        return true;
      } catch (error) {
        toast.error(errorText(error, "Failed to update the collection"));
        return false;
      }
    },

    createEndpoint: async (collectionId: string, input: CreateLocalEndpointInput) => {
      try {
        await createEpMut.mutateAsync({ collectionId, input });
        toast.success(`Added endpoint ${input.pathName}`);
        return true;
      } catch (error) {
        toast.error(errorText(error, "Failed to create the endpoint"));
        return false;
      }
    },

    updateEndpoint: async (ep: EndpointItem, input: UpdateLocalEndpointInput) => {
      try {
        await updateEndpointState(ep, input);
        toast.success("Endpoint updated");
        return true;
      } catch (error) {
        toast.error(errorText(error, "Failed to update the endpoint"));
        return false;
      }
    },

    toggleEndpointPause: async (ep: EndpointItem) => {
      try {
        await updateEndpointState(ep, { isPaused: !ep.isPaused });
        toast.info(ep.isPaused ? `Resumed ${ep.pathName}` : `Paused ${ep.pathName}`);
      } catch (error) {
        toast.error(errorText(error, "Failed to update the endpoint"));
      }
    },

    resolveConflict: async (
      kind: "collection" | "endpoint",
      id: string,
      choice: "local" | "server",
    ) => {
      try {
        await resolveMut.mutateAsync({ kind, id, choice });
        toast.success(
          choice === "local" ? "Kept this agent's version" : "Took the server's version",
        );
      } catch (error) {
        toast.error(errorText(error, "Could not resolve the conflict"));
      }
    },
  };
});
