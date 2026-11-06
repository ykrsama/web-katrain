import { afterEach, describe, expect, it, vi } from 'vitest';
import { FoxClient, FOX_LIMITS, type FoxCache } from '../workers/fox/client';
import { createFoxWorker, type FoxEnv } from '../workers/fox';
import config from '../workers/fox/wrangler.json';

// Synthetic protocol fixtures, never presented as downloaded public records.
const SGF = '\ufeff(;GM[1]SZ[19]KM[375]HA[2]PB[测试黑方]PW[Fixture W]AB[pd][dp];W[qq](;B[aa])(;B[bb]))\n';
const RECORD_ID = '1793188530010001919';
const PAGE = { result: 0, chesslist: [
  { chessid: RECORD_ID, blacknick: 'Fixture B', whitenick: 'Fixture W', movenum: 2 },
  { chessid: '8765', blackname: 'Other B', whiteenname: 'Other W', movenum: '3' },
] };

function setup() {
  const transport = vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('QueryUserInfoPanel')) return Response.json({ result: 0, uid: '123', username: 'Fixture' });
    if (url.pathname.endsWith('YHWQFetchChessList')) return Response.json(PAGE);
    return Response.json({ result: 0, chess: SGF });
  });
  const env: FoxEnv = {
    FOX_ALLOWED_ORIGINS: 'https://board.example,https://other.example',
    FOX_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
  };
  const worker = createFoxWorker(transport);
  const request = (route: string, init?: RequestInit) => worker.fetch(new Request(`https://fox.example/api/fox/${route}`, init), env);
  return { transport, env, request };
}

afterEach(() => vi.useRealTimers());

describe('Fox public protocol', () => {
  it('prefers a matching numeric nickname in automatic search, preserving its live game', async () => {
    const { request, transport } = setup();
    transport.mockResolvedValueOnce(Response.json({ result: 0, uid: '456', username: '123', state_info: [{ state: 2, room_key: { svr_type: 20010, svr_id: 1, room_id: 123, create_time: 123456 } }] }));
    expect(await (await request('player?q=123')).json()).toMatchObject({ uid: '456', mode: 'nickname', live: [{ playerUid: '456' }] });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(new URL(String(transport.mock.calls[0][0])).searchParams.get('username')).toBe('123');
  });

  it.each([101201, 104013, 0])('uses a numeric UID only after an explicit missing-account response (%s)', async result => {
    const { request, transport } = setup();
    transport.mockResolvedValueOnce(Response.json({ result, uid: '0' }));
    expect(await (await request('player?q=00123')).json()).toMatchObject({ uid: '00123', mode: 'uid' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('does not turn upstream failures or a missing text nickname into a UID match', async () => {
    const { request, transport } = setup();
    for (const response of [new Response('', { status: 503 }), Response.json({ result: 8 }), Response.json({ result: 0 }), Response.json({ result: 101201, uid: '123' })]) {
      transport.mockResolvedValueOnce(response);
      expect((await request('player?q=123')).status).toBe(502);
    }
    transport.mockResolvedValueOnce(Response.json({ result: 104013, uid: '0' }));
    expect((await request('player?q=not-found')).status).toBe(404);
    transport.mockRejectedValueOnce(new Error('fixture network failure'));
    expect((await request('player?q=123')).status).toBe(502);
  });

  it('finds a named player’s current game, excluding spectated rooms and malformed or duplicate locations', async () => {
    const { request, transport } = setup();
    const playing = { state: 2, room_key: { svr_type: 20010, svr_id: 1, room_id: 123, create_time: '123456' } };
    transport.mockResolvedValueOnce(Response.json({ result: 0, uid: '123', username: 'Display alias', openid: 'must-not-leak', state_info: [playing, playing,
      { state: 3, room_key: { ...playing.room_key, room_id: 456 } },
      { state: 2, room_key: { ...playing.room_key, create_time: 'invalid' } },
    ] }));
    const response = await request('player?q=obw12345');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ uid: '123', nickname: 'Display alias', mode: 'nickname', live: [{ serverType: 20010, serverId: 1, roomId: 123, createTime: 123456, playerUid: '123' }] });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(new URL(String(transport.mock.calls[0][0])).searchParams.get('username')).toBe('obw12345');
  });

  it('returns an empty current-game list for offline profiles without querying historical records', async () => {
    const { request, transport } = setup();
    expect(await (await request('player?q=Fixture')).json()).toMatchObject({ uid: '123', live: [] });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('resolves Unicode and numeric nicknames explicitly and preserves the chessid cursor', async () => {
    const { request, transport } = setup();
    const response = await request('search?' + new URLSearchParams({ q: '榴莲拌肥肠', mode: 'nickname' }));
    const data = await response.json();
    expect(data.user.uid).toBe('123');
    expect(data.games.map((game: { chessid: string }) => game.chessid)).toEqual([RECORD_ID, '8765']);
    expect(data.next_cursor).toBe('8765');
    expect(data.can_request_next).toBe(true);
    expect(new URL(String(transport.mock.calls[0][0])).searchParams.get('username')).toBe('榴莲拌肥肠');
    for (const [input, options] of transport.mock.calls) {
      expect(new URL(String(input)).protocol).toBe('https:');
      // Workers rejects the standard Fetch "error" redirect mode at runtime.
      expect(options?.redirect).toBe('manual');
    }
    await request('games?uid=123&cursor=8765');
    expect(new URL(String(transport.mock.lastCall![0])).searchParams.get('lastcode')).toBe('8765');
    transport.mockClear();
    await request('search?q=123&mode=nickname');
    expect(new URL(String(transport.mock.calls[0][0])).pathname).toContain('QueryUserInfoPanel');
  });

  it('uses explicit UIDs without a nickname lookup and rejects invalid or duplicate inputs', async () => {
    const { request, transport } = setup();
    expect(await (await request('player?q=00123&mode=uid')).json()).toMatchObject({ uid: '00123', mode: 'uid' });
    expect(transport).not.toHaveBeenCalled();
    expect((await request('search?q=00123&mode=uid')).status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(new URL(String(transport.mock.calls[0][0])).searchParams.get('dstuid')).toBe('00123');
    for (const route of ['search?q=１２３&mode=uid', 'search?q=12x&mode=uid', 'search?q=x&mode=bad', 'search?q=x&q=y', 'games?uid=123&cursor=-1', 'sgf', 'sgf?id=1&id=2']) {
      transport.mockClear();
      expect((await request(route)).status, route).toBe(400);
      expect(transport).not.toHaveBeenCalled();
    }
  });

  it('stops pagination on empty pages or a cursor that does not advance', async () => {
    const { request, transport } = setup();
    transport.mockResolvedValueOnce(Response.json({ result: 0, chesslist: [] }));
    expect(await (await request('games?uid=123')).json()).toMatchObject({ games: [], next_cursor: null, can_request_next: false });
    expect(await (await request('games?uid=123&cursor=8765')).json()).toMatchObject({ can_request_next: false });
  });

  it('returns identical UTF-8 source for preview and download without converting komi or removing variations', async () => {
    const { request } = setup();
    const data = await (await request(`sgf?id=${RECORD_ID}`)).json();
    expect(data).toMatchObject({ sgf: SGF, secure_transport: true, info: { black: '测试黑方', white: 'Fixture W', komi: '375' } });
    expect(data.bytes).toBe(new TextEncoder().encode(SGF).length);
    const response = await request(`download/${RECORD_ID}.sgf`);
    expect(response.headers.get('Content-Disposition')).toContain(`fox-${RECORD_ID}.sgf`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new TextEncoder().encode(SGF));
  });

  it.each([
    { result: 8, resultstr: 'fixture business failure' },
    { result: 0 },
    { result: 0, chesslist: [{ chessid: Number(RECORD_ID) }] },
  ])('reports upstream failures instead of fabricating an empty page: %j', async payload => {
    const { request, transport } = setup();
    transport.mockResolvedValueOnce(Response.json(payload));
    expect((await request('games?uid=123')).status).toBe(502);
  });

  it.each(['', '<html>blocked</html>'])('rejects an invalid SGF payload', async chess => {
    const { request, transport } = setup();
    transport.mockResolvedValueOnce(Response.json({ result: 0, chess }));
    expect((await request('sgf?id=123')).status).toBe(502);
  });

  it('rejects redirects and HTML rather than following a different upstream', async () => {
    const { request, transport } = setup();
    transport.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://elsewhere.example' } }));
    expect((await request('games?uid=123')).status).toBe(502);
    expect(transport).toHaveBeenCalledTimes(1);
    transport.mockResolvedValueOnce(new Response('<html>blocked</html>'));
    expect((await request('games?uid=123')).status).toBe(502);
  });

  it('limits streamed upstream bodies and times out network reads', async () => {
    const { request, transport } = setup();
    const cancel = vi.fn();
    transport.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(FOX_LIMITS.maxBytes + 1)); }, cancel,
    })));
    expect((await request('games?uid=123')).status).toBe(502);
    expect(cancel).toHaveBeenCalled();
    vi.useFakeTimers();
    transport.mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const pending = request('games?uid=123');
    await vi.advanceTimersByTimeAsync(FOX_LIMITS.timeoutMs);
    expect((await pending).status).toBe(504);
  });

  it('briefly caches successful upstream requests and never caches business errors', async () => {
    const entries = new Map<string, Response>();
    const cache: FoxCache = {
      match: vi.fn(async input => entries.get((input as Request).url)?.clone()),
      put: vi.fn(async (input, response) => { entries.set((input as Request).url, response.clone()); }),
    };
    const { transport } = setup();
    const client = new FoxClient(transport, cache);
    await client.games('123'); await client.games('123');
    expect(transport).toHaveBeenCalledTimes(1);
    expect([...entries.values()][0].headers.get('Cache-Control')).toContain(String(FOX_LIMITS.cacheSeconds));
    transport.mockResolvedValueOnce(Response.json({ result: 1 }));
    await expect(client.games('456')).rejects.toThrow();
    await client.games('456');
    expect(transport).toHaveBeenCalledTimes(3);
  });
});

describe('Fox Worker browser boundary', () => {
  it('checks capability without calling Fox and sets exact-origin CORS headers', async () => {
    const { request, transport } = setup();
    const response = await request('status', { headers: { Origin: 'https://board.example' } });
    expect(await response.json()).toMatchObject({ ok: true, fox: 'public-records-only' });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://board.example');
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects foreign origins, unsupported methods and unknown routes without upstream calls', async () => {
    const { request, transport } = setup();
    expect((await request('status', { headers: { Origin: 'https://board.example.evil.test' } })).status).toBe(403);
    expect((await request('games?uid=123', { method: 'POST' })).status).toBe(405);
    expect((await request('unknown')).status).toBe(404);
    expect(transport).not.toHaveBeenCalled();
  });

  it('supports preflight, direct download navigation and HEAD', async () => {
    const { request, transport } = setup();
    const preflight = await request('games', { method: 'OPTIONS', headers: { Origin: 'https://board.example', 'Access-Control-Request-Method': 'GET' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(transport).not.toHaveBeenCalled();
    expect((await request('status', { method: 'HEAD' })).body).toBeNull();
    expect((await request('download/123.sgf')).status).toBe(200);
  });

  it('rate limits across routes before making upstream calls, with readable CORS errors', async () => {
    const { request, transport, env } = setup();
    vi.mocked(env.FOX_RATE_LIMITER.limit).mockResolvedValueOnce({ success: false });
    const response = await request('games?uid=123', { headers: { Origin: 'https://board.example', 'CF-Connecting-IP': '192.0.2.1' } });
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe(String(config.ratelimits[0].simple.period));
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://board.example');
    expect(env.FOX_RATE_LIMITER.limit).toHaveBeenCalledWith({ key: '192.0.2.1' });
    expect(transport).not.toHaveBeenCalled();
  });
});
