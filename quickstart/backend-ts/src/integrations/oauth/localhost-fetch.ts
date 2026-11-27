import { lookup } from 'node:dns/promises';

/** Matches 127.0.0.0/8, ::1, and IPv4-mapped loopback, which Bun's fetch already reaches for *.localhost. */
const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/i;

/**
 * True for a name under localhost, ignoring one trailing dot.
 * Bare localhost stays on loopback; only the suffixed names are Docker aliases.
 */
export function isLocalhostSubdomain(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/, '');
  return name.endsWith('.localhost');
}

/**
 * Returns the first non-loopback address the system resolver knows for a name.
 * Undefined when the name is unknown or resolves only to loopback, as on a developer host.
 * Other resolver errors reject.
 */
async function resolveAlias(hostname: string): Promise<string | undefined> {
  const addresses = await lookup(hostname, { all: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOTFOUND') return [];
    throw error;
  });
  return addresses.find(({ address }) => !LOOPBACK.test(address))?.address;
}

/**
 * Points a URL at a resolved address without dropping its port.
 * An IPv6 address has to be bracketed or the URL parser leaves the hostname unchanged.
 */
function pointAtAddress(url: URL, address: string): void {
  if (!address.includes(':')) {
    url.hostname = address;
    return;
  }
  url.host = url.port ? `[${address}]:${url.port}` : `[${address}]`;
}

/**
 * Fetches a *.localhost URL at the address the system resolver returns and keeps the original Host.
 * Bun's fetch sends those names to loopback, which misses Docker DNS aliases such as keycloak.localhost.
 * Names without a non-loopback address, and all other hosts, are fetched unchanged.
 * A failed connection to an alias names the address that was tried.
 */
export async function fetchLocalhostAlias(url: string, options: RequestInit): Promise<Response> {
  const target = new URL(url);
  if (!isLocalhostSubdomain(target.hostname)) return fetch(url, options);
  const address = await resolveAlias(target.hostname);
  if (!address) return fetch(url, options);

  /** Original host:port, sent as Host so Keycloak still reports the *.localhost issuer. */
  const host = target.host;
  pointAtAddress(target, address);
  const headers = new Headers(options.headers);
  headers.set('host', host);
  try {
    return await fetch(target, { ...options, headers });
  } catch (cause) {
    throw new Error(`Could not reach ${host} at ${target.hostname}`, { cause });
  }
}
