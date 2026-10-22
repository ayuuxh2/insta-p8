import { lookup } from "node:dns/promises"
import net from "node:net"

/**
 * Server-only SSRF destination guard.
 *
 * General URL syntax validation lives in `lib/is-http-url.ts` (pure, so the
 * client can share it). `resolvePublicHost` here answers the different question:
 * "is it safe for *our* server to make a request to this host?" It resolves DNS
 * and rejects loopback, private, link-local, multicast and cloud-metadata
 * destinations.
 *
 * They must stay separate: URL syntax validation is NOT SSRF protection, because
 * `http://169.254.169.254/latest/meta-data/` is a perfectly valid URL that would
 * otherwise let a caller reach the cloud metadata service.
 */

/** CIDR blocks that must never be reachable from a user-supplied URL. */
const PRIVATE_IPV4_BLOCKS: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local + cloud metadata (169.254.169.254)
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved / broadcast
]

function ipv4ToInt(ip: string): number | null {
  const parts = ip.trim().split(".")
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = (value << 8) | octet
  }
  return value >>> 0
}

function isPrivateIpv4Int(value: number): boolean {
  return PRIVATE_IPV4_BLOCKS.some(([base, bits]) => {
    const baseInt = ipv4ToInt(base)
    if (baseInt === null) return false
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    return (value & mask) === (baseInt & mask)
  })
}

/** Expand an IPv6 address into its eight 16-bit groups, or null when malformed. */
function expandIpv6(input: string): number[] | null {
  let address = input.trim().toLowerCase()
  const zone = address.indexOf("%")
  if (zone !== -1) address = address.slice(0, zone)
  if (!address.includes(":")) return null

  // Fold a trailing embedded IPv4 (`::ffff:127.0.0.1`) into two hex groups so
  // the ::fff/96 and NAT64 blocks can be checked with the IPv4 rules.
  const lastColon = address.lastIndexOf(":")
  const lastGroup = address.slice(lastColon + 1)
  if (lastGroup.includes(".")) {
    const embedded = ipv4ToInt(lastGroup)
    if (embedded === null) return null
    const hi = ((embedded >>> 16) & 0xffff).toString(16)
    const lo = (embedded & 0xffff).toString(16)
    address = `${address.slice(0, lastColon + 1)}${hi}:${lo}`
  }

  const halves = address.split("::")
  if (halves.length > 2) return null
  const parseGroups = (chunk: string) => (chunk ? chunk.split(":").map((g) => parseInt(g, 16)) : [])
  const head = parseGroups(halves[0])
  const tail = halves.length === 2 ? parseGroups(halves[1]) : []
  if ([...head, ...tail].some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null

  if (halves.length === 1) return head.length === 8 ? head : null
  const missing = 8 - head.length - tail.length
  if (missing < 1) return null
  return [...head, ...new Array(missing).fill(0), ...tail]
}

/**
 * True for any address that is not publicly routable. Unparseable input is
 * treated as private so a parser bug can never fail open.
 */
export function isPrivateAddress(address: string): boolean {
  const version = net.isIP(address)
  if (version === 4) {
    const value = ipv4ToInt(address)
    return value === null ? true : isPrivateIpv4Int(value)
  }
  if (version === 6) {
    const groups = expandIpv6(address)
    if (!groups) return true
    if (groups.every((g) => g === 0)) return true // ::
    if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true // ::1
    const first = groups[0]
    if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
    if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return true // ff00::/8 multicast
    if (first === 0x2001 && groups[1] === 0x0db8) return true // 2001:db8::/32 docs
    const ipv4Mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff
    const ipv4Compatible = groups.slice(0, 6).every((g) => g === 0)
    const nat64 = groups[0] === 0x0064 && groups[1] === 0xff9b
    if (ipv4Mapped || ipv4Compatible || nat64) {
      const embedded = ((groups[6] << 16) | groups[7]) >>> 0
      return isPrivateIpv4Int(embedded)
    }
    return false
  }
  return true
}

export interface HostResolution {
  ok: boolean
  reason?: string
}

/**
 * Decide whether a hostname is safe to connect to from the server.
 *
 * Resolves every A/AAAA record and rejects the host when *any* of them is a
 * private/internal address (a name that resolves to a public and a private
 * address must not be usable, or the request could land on the private one).
 * DNS failures are reported as `ok: false` so callers never make the request
 * without a verified destination.
 */
export async function resolvePublicHost(hostname: string): Promise<HostResolution> {
  const host = hostname.trim().replace(/^\[|\]$/g, "").toLowerCase()
  if (!host) return { ok: false, reason: "missing hostname" }

  if (net.isIP(host)) {
    return isPrivateAddress(host) ? { ok: false, reason: "private address" } : { ok: true }
  }

  // Names that are internal by convention even before DNS is consulted.
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "internal hostname" }
  }

  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(host, { all: true })
  } catch {
    return { ok: false, reason: "unresolvable host" }
  }
  if (addresses.length === 0) return { ok: false, reason: "unresolvable host" }
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    return { ok: false, reason: "private address" }
  }
  return { ok: true }
}
