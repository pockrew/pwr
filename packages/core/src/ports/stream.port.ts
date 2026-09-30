import type { WebhookEvent, WsServerMessage } from "@pockrew/pwr-shared/schemas";

export interface IStreamPort {
  broadcastToTunnel(tunnelId: string, message: WsServerMessage): void;
  broadcastWebhook(event: WebhookEvent): void;
  getConnectedAgentsCount(tunnelId: string): number;
}
