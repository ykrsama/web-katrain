/** The origin of the Fox Worker; empty preserves same-origin reverse proxies. */
export function foxApiUrl(route: string, base = import.meta.env.VITE_FOX_API_BASE_URL ?? ''): string {
  return `${base.trim().replace(/\/+$/, '')}/api/fox/${route}`;
}
