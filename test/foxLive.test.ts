import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyFoxOperation, FOX_LIVE_LIMITS, foxBytes as b, foxData, foxInt, foxLivePacket, foxLiveSgf, foxMessage as m, foxNumber as n, foxRoomKey, readFoxFields, readFoxLivePacket, readFoxLiveSnapshot, type FoxLiveSnapshot } from '../src/utils/foxLiveProtocol';
import { connectFoxLive } from '../src/utils/foxLiveClient';
import { useGameStore } from '../src/store/gameStore';
import { useFoxLiveStore } from '../src/store/foxLiveStore';
import { parseSgf, generateSgfFromTree } from '../src/utils/sgf';
import type { Move } from '../src/types';

// Synthetic protocol fixtures: no real room, visitor identities or player data.
const room = { serverType: 20010, serverId: 1, roomId: 123, createTime: 123456, chessId: '1234567890123456789', boardSize: 19, playerUid: '123' };
const key = foxRoomKey(room);
const str = (id: number, value: string) => b(id, new TextEncoder().encode(value));
const start = m(b(1, m(n(1, room.boardSize), n(4, 375), n(9, 1))), str(8, room.chessId), b(9, m(n(1, 123), str(3, 'Fixture B'), n(6, 1))), b(9, m(n(1, 124), str(3, 'Fixture W'), n(6, 2))));
const operation = (type: number, data: Uint8Array, seq: number) => m(b(1, key), n(2, type), b(3, data), n(4, seq));
const move = (x: number, y: number, color: number, seq: number) => operation(203, m(n(1, x), n(2, y), n(3, color)), seq);
function snapshotBody(ops = [operation(107, start, 1), move(3, 3, 1, 2)]) {
  return m(n(1, 0), b(2, m(b(1, key), b(2, m(b(1, key), ...ops.map(op => b(2, op)), n(3, ops.length))))));
}
class Socket {
  static instances: Socket[] = [];
  readyState = 0; binaryType = '';
  onopen: (() => void) | null = null; onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null; onerror: (() => void) | null = null;
  sent: ArrayBuffer[] = [];
  constructor() { Socket.instances.push(this); }
  send(data: ArrayBuffer) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(message: number, server: number, body: Uint8Array) { this.onmessage?.(new MessageEvent('message', { data: foxLivePacket(message, server, body) })); }
}
function handshake(ws: Socket, body = snapshotBody()) {
  ws.open();
  ws.receive(102, 30016, m(n(1, 0), b(2, m(n(1, 30017), n(2, 3))), b(2, m(n(1, 30017), n(2, 1)))));
  ws.receive(109, 30017, m(n(1, 0), b(2, n(1, 9007199254740993n))));
  ws.receive(108, 30017, body);
}
afterEach(() => { useFoxLiveStore.getState().stop(); vi.useRealTimers(); vi.unstubAllGlobals(); Socket.instances = []; });

describe('Fox live records', () => {
  it('reconstructs played moves and undos, excludes commentary variations, and keeps source komi explicit', () => {
    const state = readFoxLiveSnapshot(snapshotBody([
      operation(107, start, 1), move(3, 3, 1, 2), move(4, 4, 2, 3),
      operation(603, str(1, 'not a played line'), 4), operation(213, n(2, 1), 5),
      move(5, 5, 2, 6), operation(206, new Uint8Array(), 7),
    ]), room);
    expect(state.moves).toEqual([{ x: 3, y: 3, player: 'black' }, { x: 5, y: 5, player: 'white' }, { x: -1, y: -1, player: 'black' }]);
    expect(state).toMatchObject({ black: 'Fixture B', white: 'Fixture W', komi: '375' });
    const sgf = foxLiveSgf(state, 7.5);
    expect(parseSgf(sgf).komi).toBe(7.5);
    expect(parseSgf(sgf).moves).toHaveLength(state.moves.length);
    expect(state.komi).toBe('375');
  });
  it('rejects a different game, unsupported setup, corrupted packets and out-of-order updates', () => {
    expect(() => readFoxLiveSnapshot(snapshotBody(), { ...room, chessId: '456' })).toThrow();
    expect(() => readFoxLiveSnapshot(snapshotBody(), { ...room, playerUid: '999' })).toThrow();
    expect(readFoxLiveSnapshot(snapshotBody(), { serverType: room.serverType, serverId: room.serverId, roomId: room.roomId, createTime: room.createTime, playerUid: room.playerUid }).moves).toHaveLength(1);
    const handicap = m(b(1, m(n(1, 19), n(3, 2), n(4, 375), n(9, 1))), str(8, room.chessId));
    expect(() => readFoxLiveSnapshot(snapshotBody([operation(107, handicap, 1)]), room)).toThrow();
    const packet = foxLivePacket(108, 30017, snapshotBody());
    new Uint8Array(packet)[10] ^= 1;
    expect(() => readFoxLivePacket(packet)).toThrow();
    expect(() => readFoxFields(new Uint8Array([10, 99, 1]))).toThrow();
    const state = readFoxLiveSnapshot(snapshotBody(), room);
    expect(applyFoxOperation(state, move(4, 4, 2, state.sequence), room, true)).toBe(state);
    expect(() => applyFoxOperation(state, move(4, 4, 2, state.sequence + 2), room, true)).toThrow();
    expect(() => applyFoxOperation(state, move(19, 1, 2, state.sequence + 1), room, true)).toThrow();
  });
  it('discovers size and game identity internally and accepts Japanese rules and clock-only extensions', () => {
    const startFor = (rule: number, komi: number, additional: number) => m(b(1, m(n(1, 19), n(4, komi), n(9, rule), n(17, additional))), str(8, room.chessId), b(9, m(n(1, 123), str(3, 'Fixture B'), n(6, 1))));
    const discovered = { serverType: room.serverType, serverId: room.serverId, roomId: room.roomId, createTime: room.createTime, playerUid: room.playerUid };
    expect(readFoxLiveSnapshot(snapshotBody([operation(107, startFor(2, 650, 0), 1)]), discovered)).toMatchObject({ boardSize: 19, chessId: room.chessId, rules: 'Japanese', komi: '650' });
    expect(readFoxLiveSnapshot(snapshotBody([operation(107, startFor(1, 375, 5), 1)]), discovered)).toMatchObject({ rules: 'Chinese', komi: '375' });
  });
  it('maintains visitor identity precision, sends heartbeats and resyncs from a fresh snapshot after a gap', async () => {
    vi.useFakeTimers();
    const states: FoxLiveSnapshot[] = [];
    const phase = vi.fn();
    const stop = connectFoxLive(room, { snapshot: value => states.push(value), phase }, () => new Socket() as unknown as WebSocket);
    const first = Socket.instances[0]; handshake(first);
    // Read the transport from the gateway header without converting the int64 to Number.
    const raw = new Uint8Array(first.sent[2]); const headLen = new DataView(first.sent[2]).getUint16(5);
    const header = readFoxFields(raw.subarray(7, 7 + headLen));
    expect(foxInt(readFoxFields(foxData(header, 11)), 1)).toBe(9007199254740993n);
    await vi.advanceTimersByTimeAsync(FOX_LIVE_LIMITS.heartbeatMs);
    expect(readFoxLivePacket(first.sent.at(-1)!).message).toBe(107);
    first.receive(103, 30017, b(1, move(4, 4, 2, states[0].sequence + 2)));
    await vi.advanceTimersByTimeAsync(1000);
    const second = Socket.instances[1];
    handshake(second, snapshotBody([operation(107, start, 1), move(3, 3, 1, 2), move(4, 4, 2, 3)]));
    expect(states.at(-1)?.moves).toHaveLength(2);
    first.receive(103, 30017, b(1, move(6, 6, 1, 4)));
    expect(states.at(-1)?.moves).toHaveLength(2);
    stop(); await vi.advanceTimersByTimeAsync(FOX_LIVE_LIMITS.staleMs);
    expect(Socket.instances).toHaveLength(2);
  });
});

describe('Fox live board session', () => {
  function game() {
    const state = useGameStore.getState();
    state.updateSettings({ soundEnabled: false, loadSgfFastAnalysis: false });
    state.loadGame(parseSgf('(;SZ[19]KM[7.5])'));
    return useGameStore.getState();
  }
  const firstMoves: Move[] = [{ x: 3, y: 3, player: 'black' }, { x: 4, y: 4, player: 'white' }];
  it('preserves reader position, annotations and branches while extending and correcting the played line', () => {
    const state = game(); const root = state.rootNode;
    let line = state.syncFoxLiveMoves(root.id, [root], firstMoves, true)!;
    const oldTip = line.at(-1)!; oldTip.note = 'Reader note';
    state.jumpToNode(line[1]);
    state.playMove(5, 5, true); const variation = useGameStore.getState().currentNode;
    line = state.syncFoxLiveMoves(root.id, line, [...firstMoves, { x: 6, y: 6, player: 'black' }], false)!;
    expect(useGameStore.getState().currentNode).toBe(variation);
    expect(oldTip.note).toBe('Reader note');
    expect(line[1].children).toContain(variation);
    line = state.syncFoxLiveMoves(root.id, line, firstMoves.slice(0, 1), true)!;
    expect(useGameStore.getState().moveHistory).toHaveLength(1);
    expect(line[1].children).toContain(oldTip);
    expect(parseSgf(generateSgfFromTree(root)).moves).toHaveLength(1);
    line = state.syncFoxLiveMoves(root.id, line, [firstMoves[0], { x: 7, y: 7, player: 'white' }], true)!;
    expect(line.at(-1)?.move).toMatchObject({ x: 7, y: 7 });
    expect(oldTip.note).toBe('Reader note');
  });
  it('rolls back rejected moves and cannot write to a replacement game', () => {
    const state = game(); const root = state.rootNode;
    expect(() => state.syncFoxLiveMoves(root.id, [root], [firstMoves[0], { ...firstMoves[0], player: 'white' }], true)).toThrow();
    expect(root.children).toHaveLength(0);
    state.resetGame();
    expect(state.syncFoxLiveMoves(root.id, [root], firstMoves, true)).toBeNull();
  });
  it('keeps observation alive after attaching, pauses on review and disconnects when a new board is loaded', () => {
    vi.stubGlobal('WebSocket', Socket);
    const state = game();
    useFoxLiveStore.getState().connect(room); handshake(Socket.instances[0]);
    useFoxLiveStore.getState().attach();
    expect(useGameStore.getState().moveHistory).toHaveLength(1);
    state.jumpToNode(state.rootNode);
    expect(useFoxLiveStore.getState().following).toBe(false);
    Socket.instances[0].receive(103, 30017, b(1, move(4, 4, 2, 3)));
    expect(useGameStore.getState().currentNode).toBe(state.rootNode);
    useFoxLiveStore.getState().follow();
    expect(useGameStore.getState().moveHistory).toHaveLength(2);
    state.resetGame();
    expect(Socket.instances[0].readyState).toBe(3);
    expect(useFoxLiveStore.getState().phase).toBe('idle');
  });
  it('disconnects if the reader changes the board state on the observed line', () => {
    vi.stubGlobal('WebSocket', Socket);
    game(); useFoxLiveStore.getState().connect(room); handshake(Socket.instances[0]); useFoxLiveStore.getState().attach();
    const state = useGameStore.getState();
    state.currentNode.gameState = { ...state.currentNode.gameState, komi: 6.5 };
    useGameStore.setState({ komi: 6.5 });
    expect(Socket.instances[0].readyState).toBe(3);
    expect(useFoxLiveStore.getState().attached).toBe(false);
  });
});
