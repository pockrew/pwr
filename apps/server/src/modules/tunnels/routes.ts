import { auditRelayManagement } from "@server/modules/audit/middleware";
import { adminGuard, requireManagementPermission } from "@server/modules/auth/guard";
import {
  removeSigningConfig,
  setSigningConfig,
  signingStatus,
} from "@server/modules/ingress/signing";
import * as keys from "@server/modules/keys/service";
import { deliveryBacklogStatus } from "@server/modules/relays/delivery.service";
import { relayService } from "@server/modules/relays/service";
import { forbiddenError, requestIdOf } from "@server/platform/error.handlers";
import type { AppEnv } from "@server/platform/types";
import {
  requireBodyValidation,
  requireParamValidation,
  requireQueryValidation,
} from "@server/platform/validator.middleware";
import { Hono } from "hono";

import {
  CollectionParamSchema,
  ConfigMutationSchema,
  ConfigSyncQuerySchema,
  CreateCollectionSchema,
  CreateEndpointSchema,
  CreateManagedTunnelSchema,
  EndpointParamSchema,
  GenerateKeySchema,
  KeyParamSchema,
  ManagementPageQuerySchema,
  SetIngressSigningSchema,
  TunnelParamSchema,
  UpdateCollectionSchema,
  UpdateEndpointSchema,
  UpdateManagedTunnelSchema,
} from "@pockrew/pwr-shared/schemas";

import * as service from "./service";
import { applyConfig, listConfig } from "./sync.repository";

/** Management uses stable parent IDs; transport slugs and local target secrets stay separate. */
export const tunnelManagementRoutes = new Hono<AppEnv>()
  .use("*", adminGuard())
  .use("*", auditRelayManagement)
  .use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  })
  .use("/:tunnelId/*", async (c, next) => {
    // Authorize before child lookup, so a CLI key cannot enumerate another tunnel.
    service.requireManagedTunnel(c.get("actor"), c.req.param("tunnelId") ?? "");
    await next();
  })
  .use("/:tunnelId/ingress-signing", async (c, next) => {
    // Provider signing secrets are controlled by the account, never delegated CLI/relay keys.
    if (c.get("actor").types !== "admin") throw forbiddenError();
    await next();
  })
  .get("/:tunnelId/ingress-signing", requireParamValidation(TunnelParamSchema), (c) =>
    c.json({
      data: signingStatus(c.req.valid("param").tunnelId),
      requestId: requestIdOf(c),
    }),
  )
  .put(
    "/:tunnelId/ingress-signing",
    requireParamValidation(TunnelParamSchema),
    requireBodyValidation(SetIngressSigningSchema),
    (c) =>
      c.json({
        data: setSigningConfig(c.req.valid("param").tunnelId, c.req.valid("json")),
        requestId: requestIdOf(c),
      }),
  )
  .delete("/:tunnelId/ingress-signing", requireParamValidation(TunnelParamSchema), (c) =>
    c.json({
      data: removeSigningConfig(c.req.valid("param").tunnelId),
      requestId: requestIdOf(c),
    }),
  )
  .get(
    "/:tunnelId/delivery-status",
    requireManagementPermission("endpoints"),
    requireParamValidation(TunnelParamSchema),
    (c) =>
      c.json({
        data: deliveryBacklogStatus(c.req.valid("param").tunnelId),
        requestId: requestIdOf(c),
      }),
  )
  .get(
    "/:tunnelId/config-sync",
    requireManagementPermission("collections"),
    requireManagementPermission("endpoints"),
    requireParamValidation(TunnelParamSchema),
    requireQueryValidation(ConfigSyncQuerySchema),
    (c) =>
      c.json({
        data: listConfig(c.req.valid("param").tunnelId, c.req.valid("query")),
        requestId: requestIdOf(c),
      }),
  )
  .post(
    "/:tunnelId/config-sync",
    requireManagementPermission("collections"),
    requireManagementPermission("endpoints"),
    requireParamValidation(TunnelParamSchema),
    requireBodyValidation(ConfigMutationSchema),
    (c) => {
      const tunnelId = c.req.valid("param").tunnelId;
      const data = applyConfig(tunnelId, c.req.valid("json"));
      // Commit config before waking delivery; failed/conflicting writes never dispatch work.
      if (data.status === "applied") relayService.send(tunnelId);
      return c.json({ data, requestId: requestIdOf(c) });
    },
  )
  .post("/", requireBodyValidation(CreateManagedTunnelSchema), (c) =>
    c.json(
      {
        data: service.createTunnel(c.get("actor"), c.req.valid("json")),
        requestId: requestIdOf(c),
      },
      201,
    ),
  )
  .get(
    "/",
    requireManagementPermission("tunnel"),
    requireQueryValidation(ManagementPageQuerySchema),
    (c) =>
      c.json({
        data: service.listTunnels(c.get("actor"), c.req.valid("query")),
        requestId: requestIdOf(c),
      }),
  )
  .get(
    "/:tunnelId",
    requireManagementPermission("tunnel"),
    requireParamValidation(TunnelParamSchema),
    (c) =>
      c.json({
        data: service.getTunnel(c.get("actor"), c.req.valid("param").tunnelId),
        requestId: requestIdOf(c),
      }),
  )
  .patch(
    "/:tunnelId",
    requireManagementPermission("tunnel"),
    requireParamValidation(TunnelParamSchema),
    requireBodyValidation(UpdateManagedTunnelSchema),
    (c) => {
      const { tunnelId } = c.req.valid("param");
      service.requireManagedTunnel(c.get("actor"), tunnelId);
      return c.json({
        data: service.updateTunnel(tunnelId, c.req.valid("json")),
        requestId: requestIdOf(c),
      });
    },
  )
  .delete(
    "/:tunnelId",
    requireManagementPermission("tunnel"),
    requireParamValidation(TunnelParamSchema),
    (c) => {
      const { tunnelId } = c.req.valid("param");
      service.requireManagedTunnel(c.get("actor"), tunnelId);
      return c.json({ data: service.deleteTunnel(tunnelId), requestId: requestIdOf(c) });
    },
  )
  .post(
    "/:tunnelId/keys",
    requireManagementPermission("keys"),
    requireParamValidation(TunnelParamSchema),
    requireBodyValidation(GenerateKeySchema),
    async (c) =>
      c.json(
        {
          data: await keys.generateKey(
            c.get("actor"),
            c.req.valid("param").tunnelId,
            c.req.valid("json"),
          ),
          requestId: requestIdOf(c),
        },
        201,
      ),
  )
  .get(
    "/:tunnelId/keys",
    requireManagementPermission("keys"),
    requireParamValidation(TunnelParamSchema),
    requireQueryValidation(ManagementPageQuerySchema),
    (c) =>
      c.json({
        data: keys.listKeys(c.req.valid("param").tunnelId, c.req.valid("query")),
        requestId: requestIdOf(c),
      }),
  )
  .delete(
    "/:tunnelId/keys/:keyId",
    requireManagementPermission("keys"),
    requireParamValidation(KeyParamSchema),
    (c) => {
      const { tunnelId, keyId } = c.req.valid("param");
      return c.json({
        data: keys.revokeKey(c.get("actor"), tunnelId, keyId),
        requestId: requestIdOf(c),
      });
    },
  )
  .get(
    "/:tunnelId/collections",
    requireManagementPermission("collections"),
    requireParamValidation(TunnelParamSchema),
    requireQueryValidation(ManagementPageQuerySchema),
    (c) => {
      const { tunnelId } = c.req.valid("param");
      return c.json({
        data: service.listCollections(tunnelId, c.req.valid("query")),
        requestId: requestIdOf(c),
      });
    },
  )
  .post(
    "/:tunnelId/collections",
    requireManagementPermission("collections"),
    requireParamValidation(TunnelParamSchema),
    requireBodyValidation(CreateCollectionSchema),
    (c) => {
      const { tunnelId } = c.req.valid("param");
      return c.json(
        {
          data: service.createCollection(tunnelId, c.req.valid("json")),
          requestId: requestIdOf(c),
        },
        201,
      );
    },
  )
  .get(
    "/:tunnelId/collections/:collectionId",
    requireManagementPermission("collections"),
    requireParamValidation(CollectionParamSchema),
    (c) => {
      const { tunnelId, collectionId } = c.req.valid("param");
      return c.json({
        data: service.getCollection(tunnelId, collectionId),
        requestId: requestIdOf(c),
      });
    },
  )
  .patch(
    "/:tunnelId/collections/:collectionId",
    requireManagementPermission("collections"),
    requireParamValidation(CollectionParamSchema),
    requireBodyValidation(UpdateCollectionSchema),
    (c) => {
      const { tunnelId, collectionId } = c.req.valid("param");
      return c.json({
        data: service.updateCollection(tunnelId, collectionId, c.req.valid("json")),
        requestId: requestIdOf(c),
      });
    },
  )
  .delete(
    "/:tunnelId/collections/:collectionId",
    requireManagementPermission("collections"),
    requireParamValidation(CollectionParamSchema),
    (c) => {
      const { tunnelId, collectionId } = c.req.valid("param");
      return c.json({
        data: service.deleteCollection(tunnelId, collectionId),
        requestId: requestIdOf(c),
      });
    },
  )
  .get(
    "/:tunnelId/collections/:collectionId/endpoints",
    requireManagementPermission("endpoints"),
    requireParamValidation(CollectionParamSchema),
    requireQueryValidation(ManagementPageQuerySchema),
    (c) => {
      const { tunnelId, collectionId } = c.req.valid("param");
      return c.json({
        data: service.listEndpoints(tunnelId, collectionId, c.req.valid("query")),
        requestId: requestIdOf(c),
      });
    },
  )
  .post(
    "/:tunnelId/collections/:collectionId/endpoints",
    requireManagementPermission("endpoints"),
    requireParamValidation(CollectionParamSchema),
    requireBodyValidation(CreateEndpointSchema),
    (c) => {
      const { tunnelId, collectionId } = c.req.valid("param");
      return c.json(
        {
          data: service.createEndpoint(tunnelId, collectionId, c.req.valid("json")),
          requestId: requestIdOf(c),
        },
        201,
      );
    },
  )
  .get(
    "/:tunnelId/collections/:collectionId/endpoints/:endpointId",
    requireManagementPermission("endpoints"),
    requireParamValidation(EndpointParamSchema),
    (c) => {
      const { tunnelId, collectionId, endpointId } = c.req.valid("param");
      return c.json({
        data: service.getEndpoint(tunnelId, collectionId, endpointId),
        requestId: requestIdOf(c),
      });
    },
  )
  .patch(
    "/:tunnelId/collections/:collectionId/endpoints/:endpointId",
    requireManagementPermission("endpoints"),
    requireParamValidation(EndpointParamSchema),
    requireBodyValidation(UpdateEndpointSchema),
    (c) => {
      const { tunnelId, collectionId, endpointId } = c.req.valid("param");
      return c.json({
        data: service.updateEndpoint(tunnelId, collectionId, endpointId, c.req.valid("json")),
        requestId: requestIdOf(c),
      });
    },
  )
  .delete(
    "/:tunnelId/collections/:collectionId/endpoints/:endpointId",
    requireManagementPermission("endpoints"),
    requireParamValidation(EndpointParamSchema),
    (c) => {
      const { tunnelId, collectionId, endpointId } = c.req.valid("param");
      return c.json({
        data: service.deleteEndpoint(tunnelId, collectionId, endpointId),
        requestId: requestIdOf(c),
      });
    },
  );
