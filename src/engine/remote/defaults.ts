export const REMOTE_ENGINE_PROXY_PATH = '/katago-proxy';

export function getDefaultRemoteEngineUrl(): string {
  // Only the development server runs Vite's WebSocket proxy. Static hosts
  // connect directly to the endpoint embedded during the production build.
  if (import.meta.env.DEV) return REMOTE_ENGINE_PROXY_PATH;
  const configured = import.meta.env.VITE_KATAGO_WS_URL?.trim();
  if (!configured) return REMOTE_ENGINE_PROXY_PATH;
  if (!/^wss?:\/\//i.test(configured)) return configured;

  const url = new URL(configured);
  if (url.pathname === '/') url.pathname = '/katago';
  return url.toString();
}
