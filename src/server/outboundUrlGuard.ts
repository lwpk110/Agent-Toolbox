import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';

export interface OutboundPolicy { allowPrivateNetwork?: boolean }
const denied = () => new Error('Outbound URL rejected: metadata, link-local, unsafe address or protocol, or private network without explicit allow.');
function ipv6Hextets(address: string): string[] | undefined {
  const lower = address.toLowerCase();
  if (isIP(lower) !== 6) return;
  const halves = lower.split('::');
  if (halves.length > 2) return;
  const parse = (part: string) => (part ? part.split(':') : []);
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...tail].some(group => group.includes('.'))) return;
  const fill = 8 - head.length - tail.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return;
  const groups = halves.length === 2 ? [...head, ...Array(fill).fill('0'), ...tail] : head;
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return;
  return groups.map(group => group.padStart(4, '0'));
}
function addressKind(address: string): 'public' | 'private' | 'denied' {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    if (a === 0 || a === 169 && b === 254 || a >= 224 || address === '168.63.129.16' || address === '100.100.100.200') return 'denied';
    if (a === 127 || a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127) return 'private';
    return 'public';
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return 'private';
    const mapped = lower.match(/^::ffff:([0-9.]+)$/) || lower.match(/^0:0:0:0:0:ffff:([0-9.]+)$/);
    if (mapped) return addressKind(mapped[1]);
    if (/^::ffff:/i.test(lower) || /^0:0:0:0:0:ffff:/i.test(lower)) return 'denied';
    const hextets = ipv6Hextets(lower);
    // AWS IMDS IPv6 lives in ULA space (fd00:ec2::/32) and must stay denied even with an explicit private allow.
    if (hextets && hextets[0] === 'fd00' && hextets[1] === '0ec2') return 'denied';
    if (/^f[cd]/i.test(lower)) return 'private';
    // Teredo 2001:0000::/32, documentation 2001:db8::/32, and 6to4 2002::/16 — not all of 2001::/16.
    if (hextets && (hextets[0] === '2002' || (hextets[0] === '2001' && (hextets[1] === '0000' || hextets[1] === '0db8')))) return 'denied';
    if (/^fe80:/i.test(lower) || /^ff/i.test(lower) || lower === '::' || !/^[23]/.test(lower)) return 'denied';
    return 'public';
  }
  return 'denied';
}
export function checkOutboundUrl(input: string, policy: OutboundPolicy = {}): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw denied(); }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /(^|\.)(metadata|metadata\.google\.internal|instance-data)(\.|$)/.test(host)) throw denied();
  const kind = isIP(host) ? addressKind(host) : host === 'localhost' || host.endsWith('.localhost') ? 'private' : undefined;
  if (kind === 'denied' || kind === 'private' && policy.allowPrivateNetwork !== true || url.protocol === 'http:' && kind !== 'private' && isIP(host)) throw denied();
  return url;
}
export async function validateOutboundUrl(input: string, policy: OutboundPolicy = {}) {
  const url = checkOutboundUrl(input, policy);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length) throw denied();
  for (const { address } of addresses) {
    const kind = addressKind(address);
    if (kind === 'denied' || kind === 'private' && policy.allowPrivateNetwork !== true || kind === 'public' && url.protocol !== 'https:') throw denied();
  }
  return { url, addresses };
}

// A checked DNS result is also the socket destination. Node's native clients do
// not consult HTTP_PROXY/HTTPS_PROXY, so a proxy cannot conceal the destination.
export async function guardedFetch(input: string | URL, init: RequestInit = {}, policy: OutboundPolicy = {}): Promise<Response> {
  const initial = await validateOutboundUrl(String(input), policy);
  const privateOrigin = initial.addresses.every(item => addressKind(item.address) === 'private') ? initial.url.origin : undefined;
  let target = initial.url;
  let method = init.method || 'GET';
  let body = init.body;
  const headers = new Headers(init.headers);
  for (let hop = 0; hop <= 10; hop++) {
    const checked = await validateOutboundUrl(target.href, { allowPrivateNetwork: policy.allowPrivateNetwork === true && target.origin === privateOrigin });
    const chosen = checked.addresses[0];
    const response = await new Promise<Response>((resolve, reject) => {
      const request = (target.protocol === 'https:' ? https : http).request(target, {
        method, headers: Object.fromEntries(headers), signal: init.signal || undefined,
        lookup: ((_host: string, optionsOrCb: { all?: boolean } | Function, maybeCb?: Function) => {
          const callback = (typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb) as Function;
          const options = typeof optionsOrCb === 'function' ? {} : optionsOrCb || {};
          const record = { address: chosen.address, family: chosen.family || 4 };
          if (options.all) callback(null, [record]); else callback(null, record.address, record.family);
        }) as any,
      }, incoming => {
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
        const chunks: Buffer[] = [];
        incoming.on('data', chunk => chunks.push(Buffer.from(chunk)));
        incoming.on('error', reject);
        incoming.on('end', () => resolve(new Response([204, 205, 304].includes(incoming.statusCode || 200) ? null : Buffer.concat(chunks), { status: incoming.statusCode || 200, headers: responseHeaders })));
      });
      request.on('error', reject);
      if (body !== undefined && body !== null) request.write(body);
      request.end();
    });
    if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.has('location')) return response;
    const next = new URL(response.headers.get('location')!, target);
    if (next.origin !== target.origin) { headers.delete('authorization'); headers.delete('cookie'); headers.delete('mcp-session-id'); }
    if (response.status === 303 || ([301, 302].includes(response.status) && method.toUpperCase() === 'POST')) { method = 'GET'; body = undefined; headers.delete('content-type'); headers.delete('content-length'); }
    target = next;
  }
  throw new Error('Outbound URL rejected: too many redirects.');
}
