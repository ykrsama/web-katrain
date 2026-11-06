import { FoxImportError } from './foxImport';
import { applyFoxOperation, FOX_LIVE_LIMITS, FOX_LIVE_SOCKET, foxBytes, foxData, foxInt, foxLivePacket, foxNumber, foxRoomKey, readFoxFields, readFoxLivePacket, readFoxLiveSnapshot, type FoxLiveRoom, type FoxLiveSnapshot } from './foxLiveProtocol';

export type FoxLivePhase = 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'error';
export type FoxLiveCallbacks = { snapshot(value: FoxLiveSnapshot): void; phase(value: FoxLivePhase, error?: Error): void };
/** One read-only visitor connection. Reconnect always requests a full snapshot. */
export function connectFoxLive(room: FoxLiveRoom, callbacks: FoxLiveCallbacks, makeSocket = (url: string): WebSocket => new WebSocket(url)): () => void {
  let socket: WebSocket | undefined;
  let closed = false, generation = 0, failures = 0;
  let retry: ReturnType<typeof setTimeout> | undefined, deadline: ReturnType<typeof setTimeout> | undefined, heartbeat: ReturnType<typeof setInterval> | undefined;
  const clear = () => { clearTimeout(deadline); clearInterval(heartbeat); };
  const close = () => { generation++; clear(); clearTimeout(retry); socket?.close(); };
  function open() {
    if (closed) return;
    const own = ++generation;
    let snapshot: FoxLiveSnapshot | null = null, serverId: number | undefined, visitor: bigint | undefined, seq = 0, lastMessage = Date.now();
    callbacks.phase(failures ? 'reconnecting' : 'connecting');
    const active = () => !closed && own === generation;
    const reconnect = (error?: Error, fatal = false) => {
      if (!active()) return;
      generation++; clear(); socket?.close();
      if (fatal || ++failures > FOX_LIVE_LIMITS.retries) { callbacks.phase('error', error ?? new FoxImportError('Could not connect to the Fox live room.')); return; }
      callbacks.phase('reconnecting', error);
      retry = setTimeout(open, Math.min(15000, 1000 * 2 ** (failures - 1)));
    };
    try { socket = makeSocket(FOX_LIVE_SOCKET); }
    catch { reconnect(new FoxImportError('Could not connect to the Fox live room.')); return; }
    const ws = socket; ws.binaryType = 'arraybuffer';
    const send = (message: number, server: number, body: Uint8Array, id?: number, tourist?: bigint) => {
      if (active() && ws.readyState === 1) ws.send(foxLivePacket(message, server, body, id, tourist));
    };
    deadline = setTimeout(() => reconnect(new FoxImportError('Could not connect to the Fox live room.')), FOX_LIVE_LIMITS.timeoutMs);
    ws.onopen = () => send(102, 30016, foxBytes(1, foxRoomKey(room)));
    ws.onmessage = event => {
      if (!active()) return;
      try {
        if (!(event.data instanceof ArrayBuffer)) throw new FoxImportError('Invalid Fox live data. Please reconnect.');
        const packet = readFoxLivePacket(event.data); const fields = readFoxFields(packet.body); lastMessage = Date.now();
        if (packet.server === 30016 && packet.message === 102) {
          if (foxInt(fields, 1) !== 0n) { reconnect(new FoxImportError('The Fox live room is unavailable or has closed.'), true); return; }
          const server = fields.filter(field => field.id === 2 && field.value instanceof Uint8Array)
            .map(field => readFoxFields(field.value as Uint8Array)).find(info => foxInt(info, 1) === 30017n);
          if (!server) throw new FoxImportError('Invalid Fox live data. Please reconnect.');
          const id = foxInt(server, 2);
          if (id < 1n || id > 0x7fffffffn) throw new FoxImportError('Invalid Fox live data. Please reconnect.');
          serverId = Number(id);
          send(109, 30017, new Uint8Array(), serverId);
        } else if (packet.server === 30017 && packet.message === 109) {
          if (serverId === undefined || foxInt(fields, 1) !== 0n) throw new FoxImportError('The Fox live room is unavailable or has closed.');
          visitor = foxInt(readFoxFields(foxData(fields, 2)), 1);
          send(108, 30017, foxBytes(1, foxRoomKey(room)), serverId, visitor);
        } else if (packet.server === 30017 && packet.message === 108) {
          if (serverId === undefined || visitor === undefined) throw new FoxImportError('Invalid Fox live data. Please reconnect.');
          snapshot = readFoxLiveSnapshot(packet.body, room); failures = 0; clearTimeout(deadline);
          callbacks.snapshot(snapshot);
          if (snapshot.result) { callbacks.phase('ended'); closed = true; close(); return; }
          callbacks.phase('connected');
          clearInterval(heartbeat);
          heartbeat = setInterval(() => {
            if (Date.now() - lastMessage > FOX_LIVE_LIMITS.staleMs) { reconnect(); return; }
            send(107, 30017, foxNumber(1, ++seq), serverId, visitor);
          }, FOX_LIVE_LIMITS.heartbeatMs);
        } else if (packet.server === 30017 && packet.message === 103) {
          if (!snapshot) throw new FoxImportError('Invalid Fox live data. Please reconnect.');
          const next = applyFoxOperation(snapshot, foxData(fields, 1), room, true);
          if (next === snapshot) return;
          const boardChanged = next.moves !== snapshot.moves || next.result !== snapshot.result;
          snapshot = next;
          if (boardChanged) callbacks.snapshot(snapshot);
          if (snapshot.result) { callbacks.phase('ended'); closed = true; close(); }
        } else if (packet.server === 30017 && [104, 105].includes(packet.message)) {
          reconnect(new FoxImportError('Fox live updates were interrupted. Reconnecting…'));
        } else if (packet.server === 30017 && packet.message === 106) {
          callbacks.phase('ended'); closed = true; close();
        }
      } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error));
        const fatal = cause instanceof FoxImportError && ['The Fox live game has changed. Search again to reconnect.', 'This Fox live setup or special rule is not supported. Use a historical record instead.'].includes(cause.message);
        reconnect(cause, fatal);
      }
    };
    ws.onerror = () => reconnect(new FoxImportError('Could not connect to the Fox live room.'));
    ws.onclose = () => reconnect();
  }
  open();
  return () => { closed = true; close(); };
}
