import { readLocalStorage, writeLocalStorage } from './storage';

export type FoxSearchEntry = { query: string };
export const FOX_SEARCH_HISTORY_LIMIT = 20;
const key = 'web-katrain:fox-search-history:v1';
export function readFoxSearchHistory(): FoxSearchEntry[] {
  try {
    const value: unknown = JSON.parse(readLocalStorage(key) ?? '[]');
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const entries: FoxSearchEntry[] = [];
    for (const item of value) {
      if (!item || typeof item.query !== 'string' || !item.query.trim() || item.query.length > 120) continue;
      // Read earlier nickname/UID entries, merging them into one recent list.
      if (item.mode !== undefined && !['nickname', 'uid'].includes(item.mode)) continue;
      const query = item.query.trim();
      if (seen.has(query)) continue;
      seen.add(query); entries.push({ query });
      if (entries.length >= FOX_SEARCH_HISTORY_LIMIT) break;
    }
    return entries;
  } catch { return []; }
}
export function saveFoxSearchHistory(entries: FoxSearchEntry[]): void {
  writeLocalStorage(key, JSON.stringify(entries.slice(0, FOX_SEARCH_HISTORY_LIMIT)));
}
export function addFoxSearchHistory(entries: FoxSearchEntry[], entry: FoxSearchEntry): FoxSearchEntry[] {
  return [entry, ...entries.filter(item => item.query !== entry.query)].slice(0, FOX_SEARCH_HISTORY_LIMIT);
}
