/** The inbound transport credential is not a provider header for storage or relay. */
export const withoutIngressApiKey = (headers: Record<string, string>): Record<string, string> => {
  const retained = { ...headers };
  for (const name of Object.keys(retained)) {
    if (name.toLowerCase() === "x-api-key") delete retained[name];
  }
  return retained;
};

const MAX_PROVIDER_ID_LENGTH = 200;

/**
 * Derive a provider-assigned delivery ID for ingress dedupe, scoped to the ingress selector.
 * Stripe sends one event ID to every endpoint, so the selector is part of the key.
 * @param headers - Received request headers (Web `Headers`, case-insensitive).
 * @param body - Raw bytes; only read (never rewritten) when a Stripe signature is present.
 * @param selector - Collection ID or target path the request was addressed to.
 * @returns Stable dedupe key, or null when the provider sends no usable ID.
 */
export const providerDeliveryKey = (
  headers: Headers,
  body: Uint8Array,
  selector: { collectionId?: string | undefined; endpointPath?: string | undefined },
): string | null => {
  // 1. Header-carried IDs: GitHub, Standard Webhooks, Svix, Shopify.
  let id =
    headers.get("x-github-delivery") ??
    headers.get("webhook-id") ??
    headers.get("svix-id") ??
    headers.get("x-shopify-webhook-id");
  // 2. Stripe carries the event ID in the signed JSON body only.
  if (!id && headers.has("stripe-signature")) {
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
      if (parsed && typeof parsed === "object" && "id" in parsed && typeof parsed.id === "string")
        id = parsed.id;
    } catch {
      // Not JSON: no dedupe key, the event is stored normally.
    }
  }
  if (!id || id.length > MAX_PROVIDER_ID_LENGTH) return null;
  return `${selector.collectionId ?? ""}|${selector.endpointPath ?? ""}|${id}`;
};
