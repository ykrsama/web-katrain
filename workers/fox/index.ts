import { FoxClient, FoxError, type FoxCache, type FoxFetch } from './client';
import config from './wrangler.json';

export interface FoxEnv {
  FOX_ALLOWED_ORIGINS: string;
  FOX_RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

export function createFoxWorker(transport: FoxFetch, cache?: FoxCache) {
  const client = new FoxClient(transport, cache);
  return {
    async fetch(request: Request, env: FoxEnv): Promise<Response> {
      const url = new URL(request.url);
      const origin = request.headers.get('Origin');
      const allowed = new Set(env.FOX_ALLOWED_ORIGINS.split(',').map(value => value.trim()).filter(Boolean));
      const headers = new Headers({
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'cross-origin', Vary: 'Origin',
      });
      const reply = (body: unknown, code = 200) => {
        const h = new Headers(headers);
        h.set('Content-Type', 'application/json; charset=utf-8');
        return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status: code, headers: h });
      };
      if (origin && origin !== url.origin && !allowed.has(origin)) return reply({ error: 'Origin is not allowed.' }, 403);
      if (origin) {
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Access-Control-Expose-Headers', 'Content-Disposition, Retry-After');
      }
      const download = url.pathname.match(/^\/api\/fox\/download\/([0-9]{1,32})\.sgf$/);
      if (!['/api/fox/status', '/api/fox/search', '/api/fox/games', '/api/fox/sgf'].includes(url.pathname) && !download) return reply({ error: 'Unknown API route.' }, 404);
      if (request.method === 'OPTIONS') {
        const method = request.headers.get('Access-Control-Request-Method');
        if (method && !['GET', 'HEAD'].includes(method)) return reply({ error: 'Method is not allowed.' }, 405);
        headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        headers.set('Access-Control-Allow-Headers', 'Accept, Content-Type');
        return new Response(null, { status: 204, headers });
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        headers.set('Allow', 'GET, HEAD, OPTIONS');
        return reply({ error: 'Method is not allowed.' }, 405);
      }
      const arg = (key: string, fallback = '') => {
        const values = url.searchParams.getAll(key);
        if (values.length > 1) throw new FoxError(`Duplicate parameter: ${key}.`, 400);
        return values[0] ?? fallback;
      };
      try {
        if (url.pathname === '/api/fox/status') return reply({ ok: true, fox: 'public-records-only', runtime: 'cloudflare-worker' });
        // Cloudflare supplies this header; local development shares one bucket.
        const { success } = await env.FOX_RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' });
        if (!success) {
          headers.set('Retry-After', String(config.ratelimits[0].simple.period));
          return reply({ error: 'Too many Fox requests. Please retry later.' }, 429);
        }
        if (url.pathname === '/api/fox/search') {
          const user = await client.resolve(arg('q'), arg('mode', 'nickname'));
          return reply({ user, ...await client.games(user.uid) });
        }
        if (url.pathname === '/api/fox/games') return reply(await client.games(arg('uid'), arg('cursor', '0')));
        const record = await client.sgf(download ? download[1] : arg('id'));
        if (!download) return reply(record);
        headers.set('Content-Type', 'application/x-go-sgf; charset=utf-8');
        headers.set('Content-Disposition', `attachment; filename="fox-${record.chessid}.sgf"`);
        return new Response(request.method === 'HEAD' ? null : record.sgf, { headers });
      } catch (error) {
        if (error instanceof FoxError) return reply({ error: error.message, source: 'fox-public-api' }, error.status);
        console.error('Fox Worker failed', error);
        return reply({ error: 'Fox service unavailable.' }, 500);
      }
    },
  };
}

export default {
  fetch(request: Request, env: FoxEnv): Promise<Response> {
    return createFoxWorker((input, init) => fetch(input, init), (caches as CacheStorage & { default: Cache }).default).fetch(request, env);
  },
};
