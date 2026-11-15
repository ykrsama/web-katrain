export const REMOTE_ENGINE_PROXY_PATH = '/katago-proxy';

/**
 * Whether `value` has the shape the one-click KataGo server prints:
 *
 *   wss://host/katago/<private-token>
 *
 * The token is one path segment, so the old `.../katago` endpoint (and the
 * relative `/katago-proxy` default) does not match. The bridge rejects a
 * trailing slash after the token, so neither does this.
 */
export function hasRemoteEngineTokenPath(value: string): boolean {
  const trimmed = value.trim();
  if (!/^wss?:\/\//i.test(trimmed)) return false;
  try {
    return /^\/katago\/[^/]+$/.test(new URL(trimmed).pathname);
  } catch {
    return false;
  }
}

export function getDefaultRemoteEngineUrl(): string {
  // Only the development server runs Vite's WebSocket proxy. Static hosts
  // connect directly to the endpoint embedded during the production build.
  if (import.meta.env.DEV) return REMOTE_ENGINE_PROXY_PATH;
  // The endpoint is used exactly as configured: a one-click server's private
  // token is part of the path, so there is no safe suffix to append.
  return import.meta.env.VITE_KATAGO_WS_URL?.trim() || REMOTE_ENGINE_PROXY_PATH;
}
