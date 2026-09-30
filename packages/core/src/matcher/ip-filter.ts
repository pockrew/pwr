export interface ICidrBlock {
  readonly network: number;
  readonly mask: number;
}

export interface IIpFilterConfig {
  readonly allowlist?: readonly string[];
  readonly denylist?: readonly string[];
}

/**
 * Converts an IPv4 dotted-decimal string to a 32-bit unsigned integer.
 *
 * @param ip - IPv4 address string (e.g. "192.168.1.1").
 * @returns 32-bit unsigned integer or null if invalid format.
 */
const ipv4ToNumber = (ip: string): number | null => {
  // 1. Split candidate IPv4 string by dot delimiter
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;

  // 2. Parse 4 octets into single 32-bit unsigned integer
  let num = 0;
  for (let i = 0; i < 4; i++) {
    const partStr = parts[i];
    if (!partStr) return null;
    const part = Number(partStr);
    if (Number.isNaN(part) || part < 0 || part > 255) return null;
    num = ((num << 8) | part) >>> 0;
  }

  // 3. Return parsed 32-bit number
  return num;
};

/**
 * Parses an IPv4 address or CIDR notation into a bitmask network structure.
 *
 * @param pattern - Single IP or CIDR block (e.g. "10.0.0.0/8" or "192.168.1.5").
 * @returns Parsed ICidrBlock or null if format is invalid.
 */
export const parseCidr = (pattern: string): ICidrBlock | null => {
  // 1. Check for CIDR slash delimiter
  const trimmed = pattern.trim();
  const slashIdx = trimmed.indexOf("/");

  // 2. Handle single IP address (full /32 mask)
  if (slashIdx === -1) {
    const net = ipv4ToNumber(trimmed);
    if (net === null) return null;
    return { network: net, mask: 0xffffffff >>> 0 };
  }

  // 3. Extract and validate prefix length
  const ipPart = trimmed.slice(0, slashIdx);
  const prefixStr = trimmed.slice(slashIdx + 1);
  const prefix = Number(prefixStr);
  if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) return null;

  // 4. Parse base IP address
  const net = ipv4ToNumber(ipPart);
  if (net === null) return null;

  // 5. Calculate bitmask and return network structure
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { network: (net & mask) >>> 0, mask };
};

/**
 * Checks whether an IP address matches a given IP pattern or CIDR block.
 *
 * @param ip - Candidate client IP address.
 * @param pattern - IP or CIDR pattern to check against.
 * @returns True if IP falls within CIDR range or matches exactly.
 */
export const isIpInCidr = (ip: string, pattern: string): boolean => {
  const cleanIp = ip.trim();
  const cleanPattern = pattern.trim();

  // 1. Exact string match (supports IPv6 like ::1 or exact hostnames)
  if (cleanIp === cleanPattern) return true;

  // 2. Parse CIDR block
  const cidr = parseCidr(cleanPattern);
  if (!cidr) return false;

  // 3. Convert candidate IP to 32-bit unsigned integer
  const ipNum = ipv4ToNumber(cleanIp);
  if (ipNum === null) return false;

  // 4. Bitwise subnet match
  return (ipNum & cidr.mask) >>> 0 === cidr.network;
};

/**
 * Tests whether an IP matches any of the patterns in a list.
 *
 * @param ip - Candidate client IP address.
 * @param patterns - Array of IP or CIDR patterns.
 * @returns True if IP matches any pattern in the list.
 */
export const isIpMatchingList = (ip: string, patterns: readonly string[]): boolean => {
  for (const pattern of patterns) {
    if (pattern.trim().length > 0 && isIpInCidr(ip, pattern)) {
      return true;
    }
  }
  return false;
};

/**
 * Splits a comma-, semicolon-, or whitespace-delimited IP string into a cleaned list.
 *
 * @param raw - Raw delimited string of IPs.
 * @returns Array of individual IP/CIDR strings.
 */
export const parseIpList = (raw?: string): string[] => {
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};

/**
 * Creates an IP firewall filter instance supporting allowlists and denylists with CIDR notation.
 *
 * @param config - IP filter configuration.
 * @returns Object with isAllowed verification method.
 */
export const createIpFilter = (config: IIpFilterConfig = {}) => {
  const allowlist = (config.allowlist ?? []).filter((p) => p.trim().length > 0);
  const denylist = (config.denylist ?? []).filter((p) => p.trim().length > 0);

  return {
    isAllowed: (ip: string): boolean => {
      // 1. Denylist has absolute priority
      if (denylist.length > 0 && isIpMatchingList(ip, denylist)) {
        return false;
      }

      // 2. If allowlist is specified, IP must match at least one pattern
      if (allowlist.length > 0) {
        return isIpMatchingList(ip, allowlist);
      }

      // 3. Default: allowed when allowlist is empty
      return true;
    },
  };
};

export type IIpFilter = ReturnType<typeof createIpFilter>;
