import { create } from 'zustand';
import { useGameStore } from './gameStore';
import type { GameNode, GameState } from '../types';
import { connectFoxLive, type FoxLivePhase } from '../utils/foxLiveClient';
import type { FoxLiveRoom, FoxLiveSnapshot } from '../utils/foxLiveProtocol';

type FoxLiveState = {
  phase: FoxLivePhase | 'idle'; snapshot: FoxLiveSnapshot | null; location: FoxLiveRoom | null; error: string | null;
  attached: boolean; following: boolean;
  connect(room: FoxLiveRoom): void; attach(): void; follow(): void; stop(): void;
};
let disconnect: (() => void) | undefined, unsubscribe: (() => void) | undefined;
let rootId: string | undefined, line: GameNode[] = [], mutating = false;
let livePositions: GameState[] = [];
let generation = 0;
export const useFoxLiveStore = create<FoxLiveState>((set, get) => ({
  phase: 'idle', snapshot: null, location: null, error: null, attached: false, following: true,
  connect(room) {
    get().stop(); const own = ++generation;
    set({ phase: 'connecting', location: room, error: null });
    disconnect = connectFoxLive(room, {
      phase(phase, error) { if (own === generation) set({ phase, error: error?.message ?? null }); },
      snapshot(snapshot) {
        if (own !== generation) return;
        try {
          if (rootId) {
            mutating = true;
            const next = useGameStore.getState().syncFoxLiveMoves(rootId, line, snapshot.moves, get().following, snapshot.result);
            if (!next) { get().stop(); return; }
            line = next;
            livePositions = line.map(node => node.gameState);
          }
          set({ snapshot, error: null });
        } catch {
          generation++; disconnect?.();
          set({ phase: 'error', error: 'The live move could not be replayed. Reconnect to resync.' });
        } finally { mutating = false; }
      },
    });
  },
  attach() {
    const snapshot = get().snapshot; if (!snapshot) return;
    const state = useGameStore.getState(); rootId = state.rootNode.id;
    mutating = true;
    try {
      line = state.syncFoxLiveMoves(rootId, [state.rootNode], snapshot.moves, true) ?? [];
      if (!line.length) throw new Error('No live line');
      livePositions = line.map(node => node.gameState);
      set({ attached: true, following: true });
    } finally { mutating = false; }
    unsubscribe?.();
    unsubscribe = useGameStore.subscribe(next => {
      if (mutating) return;
      if (next.rootNode.id !== rootId || next.settings.gameRules !== state.settings.gameRules || line.some((node, i) => node.gameState !== livePositions[i] || (i > 0 && !node.parent?.children.includes(node)))) { get().stop(); return; }
      if (next.currentNode !== line.at(-1)) set({ following: false });
    });
  },
  follow() {
    if (!rootId || !line.length) return;
    mutating = true;
    try { useGameStore.getState().jumpToNode(line.at(-1)!); set({ following: true }); }
    finally { mutating = false; }
  },
  stop() {
    generation++; disconnect?.(); disconnect = undefined;
    unsubscribe?.(); unsubscribe = undefined; rootId = undefined; line = []; livePositions = [];
    set({ phase: 'idle', snapshot: null, location: null, error: null, attached: false, following: true });
  },
}));
