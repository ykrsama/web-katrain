import type { Move } from '../types';
import { BOARD_SIZES } from './boardSize';
import { FoxImportError } from './foxImport';
import type { FoxLiveLocation } from '../types/fox';

export const FOX_LIVE_LIMITS = { frameBytes: 4 * 1024 * 1024, operations: 20000, moves: 2000, heartbeatMs: 20000, timeoutMs: 15000, staleMs: 60000, retries: 5 };
export const FOX_LIVE_SOCKET = 'wss://wss.foxwq.com/';
export type FoxLiveRoom = Omit<FoxLiveLocation, 'playerUid'> & { playerUid?: string; chessId?: string; boardSize?: number };
export type FoxLiveSnapshot = { chessId: string; boardSize: number; black: string; white: string; komi: string; rules: 'Chinese' | 'Japanese'; moves: Move[]; sequence: number; result?: string };
type WireValue = bigint | Uint8Array;
export type WireField = { id: number; value: WireValue };

const invalid = () => new FoxImportError('Invalid Fox live data. Please reconnect.');
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0; for (const p of parts) { out.set(p, offset); offset += p.length; } return out;
};
function varint(value: bigint | number): Uint8Array {
  let v = BigInt.asUintN(64, BigInt(value)); const bytes: number[] = [];
  do { let b = Number(v & 127n); v >>= 7n; if (v) b |= 128; bytes.push(b); } while (v);
  return new Uint8Array(bytes);
}
export const foxNumber = (id: number, value: bigint | number) => concat(varint(id * 8), varint(value));
export const foxBytes = (id: number, value: Uint8Array) => concat(varint(id * 8 + 2), varint(value.length), value);
export const foxMessage = (...fields: Uint8Array[]) => concat(...fields);

export function readFoxFields(bytes: Uint8Array): WireField[] {
  let offset = 0;
  function readInt() {
    let value = 0n;
    for (let i = 0; i < 10; i++) {
      if (offset >= bytes.length) throw invalid();
      const b = bytes[offset++]; if (i === 9 && b > 1) throw invalid();
      value |= BigInt(b & 127) << BigInt(i * 7);
      if (!(b & 128)) return value;
    }
    throw invalid();
  }
  const fields: WireField[] = [];
  while (offset < bytes.length) {
    const tag = Number(readInt()); const id = Math.floor(tag / 8); const wire = tag % 8;
    if (!Number.isSafeInteger(tag) || id < 1) throw invalid();
    let value: WireValue;
    if (wire === 0) value = readInt();
    else {
      const length = wire === 2 ? Number(readInt()) : wire === 1 ? 8 : wire === 5 ? 4 : -1;
      if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) throw invalid();
      value = bytes.subarray(offset, offset + length); offset += length;
    }
    fields.push({ id, value });
    if (fields.length > FOX_LIVE_LIMITS.operations * 8) throw invalid();
  }
  return fields;
}
export function foxInt(fields: WireField[], id: number, fallback = 0n): bigint {
  const values = fields.filter(f => f.id === id); if (values.length > 1) throw invalid();
  const value = values[0]?.value ?? fallback; if (typeof value !== 'bigint') throw invalid(); return value;
}
export function foxData(fields: WireField[], id: number): Uint8Array {
  const values = fields.filter(f => f.id === id); if (values.length !== 1 || !(values[0].value instanceof Uint8Array)) throw invalid(); return values[0].value;
}
const number = (fields: WireField[], id: number, fallback = 0n) => {
  const n = foxInt(fields, id, fallback); if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid(); return Number(n);
};
const text = (fields: WireField[], id: number, fallback = '') => fields.some(f => f.id === id) ? new TextDecoder('utf-8', { fatal: true }).decode(foxData(fields, id)) : fallback;

export const foxRoomKey = (room: FoxLiveRoom) => concat(foxNumber(1, room.serverType), foxNumber(2, room.serverId), foxNumber(3, room.roomId), foxNumber(4, room.createTime));

function adler32(bytes: Uint8Array): number {
  let a = 1, b = 0; for (const value of bytes) { a = (a + value) % 65521; b = (b + a) % 65521; } return ((b << 16) | a) >>> 0;
}
export function foxLivePacket(message: number, server: number, body: Uint8Array, serverId?: number, visitor?: bigint): ArrayBuffer {
  let header = concat(foxNumber(1, message), foxNumber(2, message), foxNumber(3, 0), foxNumber(5, 13), foxNumber(6, 1), foxNumber(7, server));
  if (serverId !== undefined) header = concat(header, foxNumber(8, serverId));
  if (visitor !== undefined) header = concat(header, foxBytes(11, foxNumber(1, visitor)));
  const size = new Uint8Array(2); new DataView(size.buffer).setUint16(0, header.length);
  const payload = concat(size, header, body); const packet = new Uint8Array(payload.length + 9); const view = new DataView(packet.buffer);
  if (payload.length + 7 >= 32767) throw invalid();
  view.setUint16(0, payload.length + 7); view.setUint16(2, 26200); packet[4] = 0; packet.set(payload, 5);
  view.setUint32(packet.length - 4, adler32(packet.subarray(2, packet.length - 4))); return packet.buffer;
}
export function readFoxLivePacket(buffer: ArrayBuffer): { message: number; server: number; body: Uint8Array } {
  const bytes = new Uint8Array(buffer); const view = new DataView(buffer);
  if (bytes.length < 9 || bytes.length > FOX_LIVE_LIMITS.frameBytes) throw invalid();
  const marker = view.getUint16(0); const offset = marker === 32767 ? 8 : 2;
  if (bytes.length < offset + 7 || (marker === 32767 && view.getUint16(2) !== 11)) throw invalid();
  const length = marker === 32767 ? view.getUint32(4) : marker;
  if (length !== bytes.length - offset || view.getUint16(offset) !== 26200 || bytes[offset + 2] !== 0) throw invalid();
  if (view.getUint32(bytes.length - 4) !== adler32(bytes.subarray(offset, bytes.length - 4))) throw invalid();
  const begin = offset + 3, headerLength = view.getUint16(begin);
  if (begin + 2 + headerLength > bytes.length - 4) throw invalid();
  const header = readFoxFields(bytes.subarray(begin + 2, begin + 2 + headerLength));
  return { message: number(header, 1), server: number(header, 7), body: bytes.subarray(begin + 2 + headerLength, bytes.length - 4) };
}

function roomMatches(fields: WireField[], room: FoxLiveRoom) {
  if (number(fields, 1) !== room.serverType || number(fields, 2) !== room.serverId || number(fields, 3) !== room.roomId || number(fields, 4) !== room.createTime) throw invalid();
}
export function applyFoxOperation(snapshot: FoxLiveSnapshot | null, operation: Uint8Array, room: FoxLiveRoom, checkSequence: boolean): FoxLiveSnapshot {
  const fields = readFoxFields(operation); const type = number(fields, 2); const sequence = number(fields, 4); const data = readFoxFields(foxData(fields, 3));
  roomMatches(readFoxFields(foxData(fields, 1)), room);
  if (checkSequence && snapshot && sequence <= snapshot.sequence) return snapshot;
  if (checkSequence && snapshot && sequence !== snapshot.sequence + 1) throw new FoxImportError('Fox live updates were interrupted. Reconnecting…');
  if (type === 107) {
    if (snapshot) throw new FoxImportError('The Fox live game has changed. Search again to reconnect.');
    const rules = readFoxFields(foxData(data, 1));
    const chessId = text(data, 8, foxInt(data, 3).toString());
    const boardSize = number(rules, 1);
    if ((room.chessId && chessId !== room.chessId) || (room.boardSize && boardSize !== room.boardSize)) throw new FoxImportError('The Fox live game has changed. Search again to reconnect.');
    if (!/^[0-9]{1,32}$/.test(chessId) || !BOARD_SIZES.includes(boardSize as typeof BOARD_SIZES[number])) throw invalid();
    // Additional rule 5 only adds thinking time; it does not change board play.
    if (number(rules, 3) > 0 || ![0, 5].includes(number(rules, 17)) || data.some(f => f.id === 18)) throw new FoxImportError('This Fox live setup or special rule is not supported. Use a historical record instead.');
    const rule = number(rules, 9); if (![1, 2].includes(rule)) throw new FoxImportError('This Fox live setup or special rule is not supported. Use a historical record instead.');
    const users = data.filter(f => f.id === 9).map(f => readFoxFields(f.value as Uint8Array));
    if (room.playerUid && !users.some(user => foxInt(user, 1).toString() === room.playerUid)) throw new FoxImportError('The Fox live game has changed. Search again to reconnect.');
    const name = (color: number) => { const u = users.find(u => number(u, 6) === color); return u ? text(u, 3, text(u, 19)) : ''; };
    return { chessId, boardSize, black: name(1), white: name(2), komi: BigInt.asIntN(32, foxInt(rules, 4)).toString(), rules: rule === 1 ? 'Chinese' : 'Japanese', moves: [], sequence };
  }
  if (!snapshot) throw invalid();
  const next = { ...snapshot, sequence };
  if (type === 203) {
    const x = number(data, 1), y = number(data, 2), color = number(data, 3);
    if (x >= snapshot.boardSize || y >= snapshot.boardSize || ![1, 2].includes(color)) throw invalid();
    next.moves = [...snapshot.moves, { x, y, player: color === 1 ? 'black' : 'white' }];
  } else if (type === 206) {
    const last = snapshot.moves.at(-1)?.player ?? 'white';
    next.moves = [...snapshot.moves, { x: -1, y: -1, player: last === 'black' ? 'white' : 'black' }];
  } else if (type === 213) {
    const count = number(data, 2); if (count < 1 || count > snapshot.moves.length) throw invalid();
    next.moves = snapshot.moves.slice(0, -count);
  } else if (type === 403) {
    const winner = number(data, 2); next.result = winner === 1 ? 'B+' : winner === 2 ? 'W+' : winner === 0 ? '0' : undefined;
  } else if ([600, 601, 607, 608].includes(type)) {
    throw new FoxImportError('This Fox live setup or special rule is not supported. Use a historical record instead.');
  }
  // Commentary (602), reference branches (603) and AI evaluation (609) do not alter the played line.
  if (next.moves.length > FOX_LIVE_LIMITS.moves) throw invalid();
  return next;
}
export function readFoxLiveSnapshot(body: Uint8Array, room: FoxLiveRoom): FoxLiveSnapshot {
  const response = readFoxFields(body); if (number(response, 1) !== 0) throw new FoxImportError('The Fox live room is unavailable or has closed.');
  const detail = readFoxFields(foxData(response, 2)); roomMatches(readFoxFields(foxData(detail, 1)), room);
  const list = readFoxFields(foxData(detail, 2)); roomMatches(readFoxFields(foxData(list, 1)), room);
  const operations = list.filter(f => f.id === 2); if (operations.length > FOX_LIVE_LIMITS.operations) throw invalid();
  let snapshot: FoxLiveSnapshot | null = null;
  for (const op of operations) {
    if (!(op.value instanceof Uint8Array)) throw invalid();
    snapshot = applyFoxOperation(snapshot, op.value, room, false);
  }
  if (!snapshot) throw invalid();
  return { ...snapshot, sequence: number(list, 3) };
}
export function foxLiveSgf(snapshot: FoxLiveSnapshot, komi: number): string {
  const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
  let sgf = `(;GM[1]FF[4]CA[UTF-8]SZ[${snapshot.boardSize}]KM[${komi}]RU[${snapshot.rules}]PB[${escape(snapshot.black)}]PW[${escape(snapshot.white)}]`;
  if (snapshot.result) sgf += `RE[${snapshot.result}]`;
  for (const move of snapshot.moves) sgf += `;${move.player === 'black' ? 'B' : 'W'}[${move.x < 0 ? '' : String.fromCharCode(97 + move.x, 97 + move.y)}]`;
  return sgf + ')';
}
