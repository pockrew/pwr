/**
 * Supported proxy operating modes.
 */
export type ProxyMode = "auto" | "manual" | "disabled";

/**
 * Proxy configuration model.
 */
export interface IProxyConfig {
  /** Mode of proxy resolution */
  mode: ProxyMode;
  /** Explicit HTTP proxy URL */
  httpProxy?: string | undefined;
  /** Explicit HTTPS proxy URL */
  httpsProxy?: string | undefined;
  /** Comma-separated list of hostnames/domains to bypass */
  noProxy: string;
  /** Optional custom CA certificate path */
  caCertPath?: string | undefined;
}

/**
 * Detected system environment proxy variables.
 */
export interface ISystemProxyDetected {
  httpProxy?: string | undefined;
  httpsProxy?: string | undefined;
  allProxy?: string | undefined;
  noProxy?: string | undefined;
  caCertPath?: string | undefined;
}

export const DEFAULT_PROXY_CONFIG: IProxyConfig = {
  mode: "auto",
  noProxy: "localhost,127.0.0.1,::1",
};

/**
 * Inspects process environment variables to extract OS/shell proxy configurations.
 */
export const getSystemDetectedProxy = (): ISystemProxyDetected => {
  const env = process.env;
  return {
    httpsProxy: env["HTTPS_PROXY"] ?? env["https_proxy"],
    httpProxy: env["HTTP_PROXY"] ?? env["http_proxy"],
    allProxy: env["ALL_PROXY"] ?? env["all_proxy"],
    noProxy: env["NO_PROXY"] ?? env["no_proxy"],
    caCertPath: env["NODE_EXTRA_CA_CERTS"] ?? env["SSL_CERT_FILE"],
  };
};

/**
 * Checks whether a hostname matches the no_proxy bypass list or represents a local loopback.
 *
 * @param hostname - Target hostname to evaluate.
 * @param noProxyString - Comma-separated bypass patterns.
 * @returns True if proxy should be bypassed.
 */
export const isHostBypassingProxy = (hostname: string, noProxyString?: string): boolean => {
  const cleanHost = hostname.toLowerCase().trim();

  // 1. Immutable rule: Local loopback addresses MUST always bypass proxy to prevent self-referencing traps
  if (
    cleanHost === "localhost" ||
    cleanHost === "127.0.0.1" ||
    cleanHost === "::1" ||
    cleanHost === "0.0.0.0" ||
    cleanHost.endsWith(".localhost")
  ) {
    return true;
  }

  // 2. Return false if no bypass string configured
  if (!noProxyString || noProxyString.trim().length === 0) {
    return false;
  }

  // 3. Parse comma-delimited bypass patterns
  const bypassPatterns = noProxyString
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);

  // 4. Test hostname against wildcard and exact patterns
  for (const pattern of bypassPatterns) {
    if (pattern === "*") return true;

    // Exact match
    if (pattern === cleanHost) return true;

    // Domain wildcard matching (.example.com or *.example.com)
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1);
      if (cleanHost.endsWith(suffix)) return true;
    } else if (pattern.startsWith(".")) {
      if (cleanHost.endsWith(pattern) || cleanHost === pattern.slice(1)) return true;
    }
  }

  return false;
};

/**
 * Resolves the effective outbound proxy URL for a target endpoint based on proxy mode and bypass rules.
 *
 * @param targetUrl - The target URL to connect to.
 * @param proxyConfig - Active proxy configuration.
 * @returns Resolved proxy URL string or undefined if direct connection.
 */
export const resolveProxyUrl = (
  targetUrl: string,
  proxyConfig: IProxyConfig = DEFAULT_PROXY_CONFIG,
): string | undefined => {
  // 1. Return immediately if proxy mode is disabled
  if (proxyConfig.mode === "disabled") {
    return undefined;
  }

  try {
    // 2. Parse URL and determine security protocol
    const parsed = new URL(targetUrl);
    const hostname = parsed.hostname;
    const isSecure = parsed.protocol === "https:" || parsed.protocol === "wss:";

    // 3. Evaluate local loopback and configured NO_PROXY bypass
    const effectiveNoProxy = proxyConfig.noProxy ?? "localhost,127.0.0.1,::1";
    if (isHostBypassingProxy(hostname, effectiveNoProxy)) {
      return undefined;
    }

    // 4. Resolve manual proxy configuration if mode is manual
    if (proxyConfig.mode === "manual") {
      if (isSecure && proxyConfig.httpsProxy && proxyConfig.httpsProxy.length > 0) {
        return proxyConfig.httpsProxy;
      }
      return proxyConfig.httpProxy ?? proxyConfig.httpsProxy;
    }

    // 5. Auto-detect mode: Check system environment variables
    const detected = getSystemDetectedProxy();
    const systemNoProxy = detected.noProxy ?? effectiveNoProxy;
    if (isHostBypassingProxy(hostname, systemNoProxy)) {
      return undefined;
    }

    if (isSecure && detected.httpsProxy) {
      return detected.httpsProxy;
    }
    return detected.allProxy ?? detected.httpProxy ?? detected.httpsProxy;
  } catch {
    // 6. Return undefined on URL parse error to fall back to direct connection
    return undefined;
  }
};
