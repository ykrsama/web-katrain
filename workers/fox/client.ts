import type { FoxGame, FoxLiveLocation, FoxPage, FoxRecord, FoxUser } from '../../src/types/fox';

export const FOX_LIMITS = { timeoutMs: 15000, maxBytes: 4 * 1024 * 1024, cacheSeconds: 120, profileCacheSeconds: 5, nicknameLength: 120 };
const USER_URL = 'https://newframe.foxwq.com/cgi/QueryUserInfoPanel';
const H5 = 'https://h5.foxwq.com/yehuDiamond/chessbook_local/';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
export type FoxCache = Pick<Cache, 'match' | 'put'>;
export type FoxFetch = typeof fetch;

export class FoxError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}

class FoxAccountNotFound extends FoxError {
  constructor() { super('Fox account not found.', 404); }
}

export function identity(value: string, label: string): string {
  if (!/^[0-9]{1,32}$/.test(value)) throw new FoxError(`${label} must contain 1–32 ASCII digits.`, 400);
  return value;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function upstreamIdentity(value: unknown, label: string): string {
  // JSON numeric IDs above 2^53 would silently point at a different record.
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new FoxError(`Unsafe numeric ${label} returned by Fox.`);
  const text = String(value ?? '');
  if (!/^[0-9]{1,32}$/.test(text)) throw new FoxError(`Invalid ${label} returned by Fox.`);
  return text;
}

function first(data: Record<string, unknown>, keys: string[], fallback = ''): string {
  const value = keys.map(key => data[key]).find(value => typeof value === 'string' && value);
  return typeof value === 'string' ? value : fallback;
}

async function readJson(response: Response, isProfile = false): Promise<Record<string, unknown>> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new FoxError(`Fox HTTP ${response.status}.`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new FoxError('Fox returned an empty response.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > FOX_LIMITS.maxBytes) {
        await reader.cancel();
        throw new FoxError('Fox response exceeds the size limit.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let data: unknown;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new FoxError('Fox returned invalid JSON.'); }
  if (!object(data)) throw new FoxError('Fox returned a non-object response.');
  const code = data.result ?? data.errcode ?? -1;
  // Both public profile responses mean the requested nickname was not found.
  // Keep transport, rate-limit and other upstream errors distinct: they must
  // not silently redirect a numeric nickname to another account's UID.
  if (isProfile && ['101201', '104013'].includes(String(code)) && /^0*$/.test(String(data.uid ?? ''))) throw new FoxAccountNotFound();
  if (String(code) !== '0') throw new FoxError(`Fox error ${code}: ${String(data.resultstr || data.errmsg || 'Request failed').slice(0, 300)}`);
  return data;
}

export class FoxClient {
  private readonly transport: FoxFetch;
  private readonly cache?: FoxCache;
  constructor(transport: FoxFetch, cache?: FoxCache) { this.transport = transport; this.cache = cache; }

  private async request(base: string, params: Record<string, string>, cacheSeconds = FOX_LIMITS.cacheSeconds): Promise<Record<string, unknown>> {
    const url = new URL(base);
    url.search = new URLSearchParams(params).toString();
    const cacheUrl = new URL(url);
    cacheUrl.searchParams.set('__fox_cache_ttl', String(cacheSeconds));
    const key = new Request(cacheUrl);
    // Cache availability must never decide whether a public record can be read.
    let cached: Response | undefined;
    try { cached = await this.cache?.match(key); } catch { /* Fetch upstream instead. */ }
    if (cached) {
      try { return await readJson(cached, base === USER_URL); } catch { /* Ignore a corrupt/stale cache entry. */ }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FOX_LIMITS.timeoutMs);
    try {
      const response = await this.transport(url, {
        headers: { 'User-Agent': MOBILE_UA, Accept: 'application/json,text/plain,*/*' },
        redirect: 'manual',
        signal: controller.signal,
      });
      const data = await readJson(response, base === USER_URL);
      try {
        await this.cache?.put(key, new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${cacheSeconds}` },
        }));
      } catch { /* Cache writes are best effort. */ }
      return data;
    } catch (error) {
      if (error instanceof FoxError) throw error;
      if (controller.signal.aborted) throw new FoxError('Fox request timed out.', 504);
      throw new FoxError('Could not reach the Fox public API.');
    } finally { clearTimeout(timer); }
  }

  async resolve(query: string, mode: string): Promise<FoxUser> {
    if (!query.trim() || query.length > FOX_LIMITS.nicknameLength) throw new FoxError('Enter a valid Fox nickname or UID.', 400);
    query = query.trim();
    if (mode === 'auto') {
      try { return await this.resolve(query, 'nickname'); }
      catch (error) {
        if (error instanceof FoxAccountNotFound && /^[0-9]{1,32}$/.test(query)) return this.resolve(query, 'uid');
        throw error;
      }
    }
    if (mode === 'uid') return { uid: identity(query, 'UID'), nickname: '', mode, live: [] };
    if (mode !== 'nickname') throw new FoxError('Mode must be auto, nickname or uid.', 400);
    const data = await this.request(USER_URL, { srcuid: '0', username: query }, FOX_LIMITS.profileCacheSeconds);
    const uid = upstreamIdentity(data.uid, 'UID');
    if (/^0+$/.test(uid)) throw new FoxAccountNotFound();
    const live: FoxLiveLocation[] = [];
    if (Array.isArray(data.state_info)) {
      for (const item of data.state_info) {
        // 2 = playing; 3 = observing somebody else's game. Do not follow that room.
        if (!object(item) || Number(item.state) !== 2 || !object(item.room_key)) continue;
        const key = item.room_key;
        const values = [key.svr_type, key.svr_id, key.room_id, key.create_time].map(Number);
        if (!values.every(value => Number.isSafeInteger(value) && value > 0 && value <= 0x7fffffff)) continue;
        const [serverType, serverId, roomId, createTime] = values;
        if (!live.some(room => room.serverType === serverType && room.serverId === serverId && room.roomId === roomId && room.createTime === createTime)) live.push({ serverType, serverId, roomId, createTime, playerUid: uid });
      }
    }
    return { uid, nickname: first(data, ['username', 'name', 'englishname'], query), mode, live };
  }

  async games(uid: string, cursor = '0'): Promise<FoxPage> {
    identity(uid, 'UID'); identity(cursor, 'Cursor');
    const data = await this.request(H5 + 'YHWQFetchChessList', { srcuid: '0', dstuid: uid, type: '1', lastcode: cursor, searchkey: '', uin: uid });
    if (!Array.isArray(data.chesslist)) throw new FoxError('Fox response is missing chesslist.');
    const games: FoxGame[] = [];
    for (const item of data.chesslist) {
      if (!object(item) || !item.chessid) continue;
      games.push({
        chessid: upstreamIdentity(item.chessid, 'record ID'),
        black: first(item, ['blacknick', 'blacknickname', 'blackname', 'blackenname'], 'Black'),
        white: first(item, ['whitenick', 'whitenickname', 'whitename', 'whiteenname'], 'White'),
        date: String(item.starttime ?? ''),
        moves: typeof item.movenum === 'number' || typeof item.movenum === 'string' ? item.movenum : '',
      });
    }
    const next = games.at(-1)?.chessid ?? null;
    return { uid, games, count: games.length, next_cursor: next, can_request_next: !!next && next !== cursor };
  }

  async sgf(chessid: string): Promise<FoxRecord> {
    identity(chessid, 'Record ID');
    const data = await this.request(H5 + 'YHWQFetchChess', { chessid });
    const sgf = data.chess;
    if (typeof sgf !== 'string' || !sgf.trimStart().startsWith('(;') || !sgf.trimEnd().endsWith(')')) throw new FoxError('Fox returned an unrecognizable SGF.');
    // Metadata only. The frontend parser validates the full tree before import.
    const root = sgf.trimStart().split(';', 3)[1] ?? '';
    const prop = (key: string) => root.match(new RegExp(`(?<![A-Z])${key}\\[((?:\\\\.|[^\\]\\\\])*)\\]`))?.[1] ?? '';
    return { chessid, sgf, bytes: new TextEncoder().encode(sgf).byteLength, secure_transport: true,
      info: { black: prop('PB'), white: prop('PW'), komi: prop('KM') } };
  }
}
