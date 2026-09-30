import {
  endpointSecretStatus,
  setEndpointSecret,
} from "@agent/modules/relays/credentials.repository";
import { tunnelManager } from "@agent/modules/relays/service";
import { requestIdOf } from "@agent/platform/error.handlers";
import { requireValidation } from "@agent/platform/validator.middleware";
import { getLogger } from "@logtape/logtape";
import { Hono } from "hono";

import {
  CollectionParamSchema,
  ConfigRecordParamSchema,
  ConfigResolveSchema,
  ConfigSyncQuerySchema,
  CreateCollectionSchema,
  CreateLocalEndpointSchema,
  EndpointParamSchema,
  LocalEndpointCredentialSchema,
  TunnelParamSchema,
  UpdateCollectionSchema,
  UpdateLocalEndpointSchema,
} from "@pockrew/pwr-shared/schemas";

import { configScope, configState, listLocalConfig, resolveConfig } from "./repository";
import * as service from "./service";

const logger = getLogger(["pwr", "agent", "config"]);

/** Wake stored live work after a local availability edit; the receipt remains durable on failure. */
const drainAfterConfigEdit = (tunnelId: string): void => {
  void tunnelManager.drainTunnel(tunnelId).catch(() => {
    logger.error("Local relay drain failed for {tunnelId}", { tunnelId });
  });
};

/** Offline config edge, mounted behind the daemon's existing local-access boundary. */
export const configRoutes = new Hono()
  .get(
    "/tunnels/:tunnelId/config",
    requireValidation("param", TunnelParamSchema),
    requireValidation("query", ConfigSyncQuerySchema),
    (c) => {
      const scope = configScope(c.req.valid("param").tunnelId);
      const query = c.req.valid("query");
      const rows = listLocalConfig(scope, query.kind, query.cursor);
      const items = rows.slice(0, query.limit);
      return c.json({
        data: {
          items,
          nextCursor: rows.length > query.limit ? (items.at(-1)?.value.id ?? null) : null,
          sync: configState(scope) ?? null,
        },
        requestId: requestIdOf(c),
      });
    },
  )
  .post(
    "/tunnels/:tunnelId/config/:kind/:id/resolve",
    requireValidation("param", ConfigRecordParamSchema),
    requireValidation("json", ConfigResolveSchema),
    (c) => {
      const { tunnelId, kind, id } = c.req.valid("param");
      resolveConfig(configScope(tunnelId), kind, id, c.req.valid("json").choice);
      drainAfterConfigEdit(tunnelId);
      return c.json({ data: { resolved: true }, requestId: requestIdOf(c) });
    },
  )
  .post(
    "/tunnels/:tunnelId/collections",
    requireValidation("param", TunnelParamSchema),
    requireValidation("json", CreateCollectionSchema),
    (c) =>
      c.json(
        {
          data: service.createCollection(
            configScope(c.req.valid("param").tunnelId),
            c.req.valid("json"),
          ),
          requestId: requestIdOf(c),
        },
        201,
      ),
  )
  .get(
    "/tunnels/:tunnelId/collections/:collectionId",
    requireValidation("param", CollectionParamSchema),
    (c) => {
      const { tunnelId, collectionId } = c.req.valid("param");
      return c.json({
        data: service.getCollection(configScope(tunnelId), collectionId),
        requestId: requestIdOf(c),
      });
    },
  )
  .patch(
    "/tunnels/:tunnelId/collections/:collectionId",
    requireValidation("param", CollectionParamSchema),
    requireValidation("json", UpdateCollectionSchema),
    (c) => {
      const { tunnelId, collectionId } = c.req.valid("param");
      const data = service.updateCollection(
        configScope(tunnelId),
        collectionId,
        c.req.valid("json"),
      );
      drainAfterConfigEdit(tunnelId);
      return c.json({
        data,
        requestId: requestIdOf(c),
      });
    },
  )
  .post(
    "/tunnels/:tunnelId/collections/:collectionId/endpoints",
    requireValidation("param", CollectionParamSchema),
    requireValidation("json", CreateLocalEndpointSchema),
    (c) => {
      const { tunnelId, collectionId } = c.req.valid("param");
      const data = service.createEndpoint(configScope(tunnelId), collectionId, c.req.valid("json"));
      drainAfterConfigEdit(tunnelId);
      return c.json({ data, requestId: requestIdOf(c) }, 201);
    },
  )
  .get(
    "/tunnels/:tunnelId/collections/:collectionId/endpoints/:endpointId",
    requireValidation("param", EndpointParamSchema),
    (c) => {
      const { tunnelId, collectionId, endpointId } = c.req.valid("param");
      const scope = configScope(tunnelId);
      return c.json({
        data: service.withLocalTarget(scope, service.getEndpoint(scope, collectionId, endpointId)),
        requestId: requestIdOf(c),
      });
    },
  )
  .patch(
    "/tunnels/:tunnelId/collections/:collectionId/endpoints/:endpointId",
    requireValidation("param", EndpointParamSchema),
    requireValidation("json", UpdateLocalEndpointSchema),
    (c) => {
      const { tunnelId, collectionId, endpointId } = c.req.valid("param");
      const data = service.updateEndpoint(
        configScope(tunnelId),
        collectionId,
        endpointId,
        c.req.valid("json"),
      );
      drainAfterConfigEdit(tunnelId);
      return c.json({
        data,
        requestId: requestIdOf(c),
      });
    },
  )
  .get(
    "/tunnels/:tunnelId/collections/:collectionId/endpoints/:endpointId/secret",
    requireValidation("param", EndpointParamSchema),
    (c) => {
      const { tunnelId, collectionId, endpointId } = c.req.valid("param");
      const scope = configScope(tunnelId);
      service.getEndpoint(scope, collectionId, endpointId);
      return c.json({
        data: endpointSecretStatus(scope, endpointId),
        requestId: requestIdOf(c),
      });
    },
  )
  .put(
    "/tunnels/:tunnelId/collections/:collectionId/endpoints/:endpointId/secret",
    requireValidation("param", EndpointParamSchema),
    requireValidation("json", LocalEndpointCredentialSchema),
    (c) => {
      const { tunnelId, collectionId, endpointId } = c.req.valid("param");
      const scope = configScope(tunnelId);
      // Verify local ownership, including unsynced endpoints, before touching credentials.
      service.getEndpoint(scope, collectionId, endpointId);
      const { secret, headerName } = c.req.valid("json");
      setEndpointSecret(scope, endpointId, secret, headerName);
      return c.json({
        data: endpointSecretStatus(scope, endpointId),
        requestId: requestIdOf(c),
      });
    },
  )
  .delete(
    "/tunnels/:tunnelId/collections/:collectionId/endpoints/:endpointId/secret",
    requireValidation("param", EndpointParamSchema),
    (c) => {
      const { tunnelId, collectionId, endpointId } = c.req.valid("param");
      const scope = configScope(tunnelId);
      service.getEndpoint(scope, collectionId, endpointId);
      setEndpointSecret(scope, endpointId, null);
      return c.json({
        data: endpointSecretStatus(scope, endpointId),
        requestId: requestIdOf(c),
      });
    },
  );
