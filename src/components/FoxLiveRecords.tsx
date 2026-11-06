import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { useFoxLiveStore } from '../store/foxLiveStore';
import { useGameStore } from '../store/gameStore';
import { FoxImportError, resolveFoxKomi } from '../utils/foxImport';
import { foxLiveSgf } from '../utils/foxLiveProtocol';
import { parseSgf } from '../utils/sgf';
import type { FoxLiveLocation, FoxUser } from '../types/fox';

const phaseLabels = {
  connecting: 'Connecting to Fox…', reconnecting: 'Reconnecting to Fox…', connected: 'Watching live',
  ended: 'Fox live room closed', error: 'Fox live connection failed', idle: '',
};
export function FoxLiveRecords({ player, onImport, onClose }: { player: FoxUser; onImport: (parsed: ReturnType<typeof parseSgf>, filename: string) => void; onClose(): void }) {
  const t = useT();
  const live = useFoxLiveStore();
  const [komi, setKomi] = useState('');
  const [replace, setReplace] = useState(false);
  const [error, setError] = useState<FoxImportError | null>(null);
  useEffect(() => () => {
    const current = useFoxLiveStore.getState();
    if (!current.attached) current.stop();
  }, [player.uid]);
  const selected = player.live?.some(room => room.roomId === live.location?.roomId && room.createTime === live.location?.createTime && room.playerUid === live.location?.playerUid);
  const snapshot = selected ? live.snapshot : null;
  const connect = (room: FoxLiveLocation) => {
    setError(null); setReplace(false); setKomi('');
    try { live.connect(room); }
    catch (cause) { setError(cause instanceof FoxImportError ? cause : new FoxImportError('Could not connect to the Fox live room.')); }
  };
  const watch = () => {
    if (!snapshot || !replace) return;
    try {
      const chosen = resolveFoxKomi(snapshot.komi, komi);
      if (chosen === undefined) return;
      const parsed = parseSgf(foxLiveSgf(snapshot, chosen));
      onImport(parsed, `fox-live-${snapshot.chessId}.sgf`);
      if (useGameStore.getState().sgfLoadWarning) throw new FoxImportError('The live move could not be replayed. Reconnect to resync.');
      live.attach(); onClose();
    } catch (cause) { setError(cause instanceof FoxImportError ? cause : new FoxImportError('The live move could not be replayed. Reconnect to resync.')); }
  };
  return <section className="fox-live-records">
    <h3>{t('Fox live observation')}</h3>
    {!Array.isArray(player.live) ? <p className="fox-import-warning">{t('Live lookup is unavailable. Please update the Fox service.')}</p> : !player.live.length ? <p className="fox-record-empty">{t('This player is not currently playing a live game.')}</p> : player.live.map((room, index) => <div className="fox-live-match" key={`${room.serverType}-${room.serverId}-${room.roomId}-${room.createTime}`}>
      <div><strong>{player.nickname}</strong><span>{t('Currently playing')}{player.live.length > 1 ? ` · ${index + 1}` : ''}</span></div>
      <button type="button" className="fox-primary" onClick={() => connect(room)} disabled={selected && live.phase === 'connecting'}>{t('Watch live game')}</button>
    </div>)}
    {selected && live.phase !== 'idle' && <p role="status">{t(phaseLabels[live.phase])}</p>}
    {(error || (selected && live.error)) && <p className="fox-import-error" role="alert">{error ? t(error.message, error.vars) : t(live.error!)}</p>}
    {snapshot && <section className="fox-import-detail">
      <h3>{t('{black} vs {white}', { black: snapshot.black, white: snapshot.white })}</h3>
      <p>{t('Live position: {count} moves · original komi KM[{komi}]', { count: snapshot.moves.length, komi: snapshot.komi })}</p>
      {Math.abs(Number(snapshot.komi)) >= 100 && <p className="fox-import-warning">{t('KM[{komi}] may use Fox-specific encoding. Confirm the komi before importing.', { komi: snapshot.komi })}</p>}
      <label>{t('Import komi (points)')}<input aria-label={t('Import komi')} type="number" step="0.5" min="-99.5" max="99.5" value={komi} onChange={event => setKomi(event.target.value)} /></label>
      <label className="fox-import-confirm"><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)} />{t('Import replaces the current board. I have saved any game I want to keep.')}</label>
      <div className="fox-import-actions"><button type="button" onClick={live.stop}>{t('Stop observing')}</button><button type="button" className="fox-primary" disabled={!replace || live.phase === 'error' || live.phase === 'reconnecting'} onClick={watch}>{t('Watch on board')}</button></div>
    </section>}
  </section>;
}

export function FoxLiveStatus() {
  const t = useT();
  const live = useFoxLiveStore();
  if (!live.attached || !live.snapshot) return null;
  return <aside className="fox-live-status" aria-label={t('Fox live observation')}>
    <div><strong>{t(phaseLabels[live.phase])}</strong><span>{t('{black} vs {white}', { black: live.snapshot.black, white: live.snapshot.white })} · {t('{count} moves', { count: live.snapshot.moves.length })}</span>
      {live.error && <span className="fox-import-error" role="alert">{t(live.error)}</span>}</div>
    <button type="button" onClick={live.follow}>{live.following ? t('Following latest move') : t('Follow latest move')}</button>
    <button type="button" onClick={live.stop}>{t('Stop observing')}</button>
  </aside>;
}
