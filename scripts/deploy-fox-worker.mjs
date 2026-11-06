import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(readFileSync(new URL('../workers/fox/wrangler.json', import.meta.url), 'utf8'));
for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'VITE_FOX_API_BASE_URL']) {
  if (!process.env[key]?.trim()) throw new Error(`Configure ${key} in GitHub Actions before deploying Fox.`);
}
const endpoint = new URL(process.env.VITE_FOX_API_BASE_URL);
if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
  throw new Error('VITE_FOX_API_BASE_URL must be an HTTPS origin without credentials, query, or path.');
}
if (endpoint.hostname.endsWith('.workers.dev') && endpoint.hostname.split('.')[0] !== config.name) {
  throw new Error(`Use the production Worker URL (${config.name}.<subdomain>.workers.dev), not the probe URL.`);
}
const owner = process.env.GITHUB_REPOSITORY?.split('/')[0]?.toLowerCase();
const rawOrigins = process.env.FOX_ALLOWED_ORIGINS?.trim() || (owner ? `https://${owner}.github.io` : '');
if (!rawOrigins) throw new Error('Set FOX_ALLOWED_ORIGINS to the frontend origin(s), separated by commas.');
const origins = [...new Set(rawOrigins.split(',').map(raw => {
  const url = new URL(raw.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('FOX_ALLOWED_ORIGINS must contain HTTPS origins without paths.');
  }
  return url.origin;
}))];

// Argument arrays avoid shell interpretation of account settings or origins.
execFileSync(process.execPath, [
  fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)),
  'deploy', '--config', 'workers/fox/wrangler.json', '--var', `FOX_ALLOWED_ORIGINS:${origins.join(',')}`,
], { cwd: root, stdio: 'inherit' });

// Verify the same URL and Origin the browser will use before publishing Pages.
for (const origin of origins) {
  let failure;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(new URL('/api/fox/status', endpoint), {
        headers: { Origin: origin }, signal: AbortSignal.timeout(10000), redirect: 'manual',
      });
      if (!response.ok || response.headers.get('Access-Control-Allow-Origin') !== origin) {
        throw new Error(`Worker health/CORS check failed: HTTP ${response.status} for ${origin}`);
      }
      const data = await response.json();
      if (data.ok !== true || data.fox !== 'public-records-only' || data.runtime !== 'cloudflare-worker') {
        throw new Error('Worker URL did not return the expected Fox service.');
      }
      failure = undefined;
      break;
    } catch (error) {
      failure = error;
      if (attempt < 4) await delay(2000);
    }
  }
  if (failure) throw failure;
}
console.log(`Fox Worker ready: ${endpoint.origin}`);
