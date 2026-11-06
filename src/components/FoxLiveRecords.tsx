import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { useFoxLiveStore } from '../store/foxLiveStore';
import { useGameStore } from '../store/gameStore';
import { FoxImportError } from '../utils/foxImport';
import { foxLiveSgf, type FoxLiveSnapshot } from '../utils/foxLiveProtocol';
import { parseSgf } from '../utils/sgf';
import type { FoxLiveLocation, FoxUser } from '../types/fox';
import { applyFoxImportOptions, foxImportOptions, validFoxImportOptions, type FoxImportOptions } from '../utils/foxImportOptions';
import { FoxImportSettings } from './FoxImportSettings';

const phaseLabels = {
  connecting: 'Connecting to Fox…', reconnecting: 'Reconnecting to Fox…', connected: 'Watching live',
  ended: 'Fox live room closed', error: 'Fox live connection failed', idle: '',
};
export function FoxLiveRecords({ player, onImport, onClose }: { player: FoxUser; onImport: (parsed: ReturnType<typeof parseSgf>, filename: string) => void; onClose(): void }) {
  const t = useT();
  const live = useFoxLiveStore();
  const [error, setError] = useState<FoxImportError | null>(null);
  useEffect(() => () => {
    const current = useFoxLiveStore.getState();
    if (!current.attached) current.stop();
  }, [player.uid]);
  const selected = player.live?.some(room => room.roomId === live.location?.roomId && room.createTime === live.location?.createTime && room.playerUid === live.location?.playerUid);
  const snapshot = selected ? live.snapshot : null;
  const connect = (room: FoxLiveLocation) => {
    setError(null);
    try {
      live.connect(room, snapshot => {
        const options = foxImportOptions({ KM: [snapshot.komi], RU: [snapshot.rules] });
        if (!options.needsConfirmation) watch(snapshot, options);
      });
    }
    catch (cause) { setError(cause instanceof FoxImportError ? cause : new FoxImportError('Could not connect to the Fox live room.')); }
  };
  const watch = (snapshot: FoxLiveSnapshot, options: FoxImportOptions) => {
    if (!validFoxImportOptions(options)) return;
    try {
      const parsed = applyFoxImportOptions(parseSgf(foxLiveSgf(snapshot, Number(options.komi))), options);
      onImport(parsed, `fox-live-${snapshot.chessId}.sgf`);
      if (useGameStore.getState().sgfLoadWarning) throw new FoxImportError('The live move could not be replayed. Reconnect to resync.');
      live.attach(); onClose();
    } catch (cause) { setError(cause instanceof FoxImportError ? cause : new FoxImportError('The live move could not be replayed. Reconnect to resync.')); }
  };
  return <>
    {!Array.isArray(player.live) ? <tr><td colSpan={3}><p className="fox-import-warning">{t('Live lookup is unavailable. Please update the Fox service.')}</p></td></tr> : player.live.map(room => <tr className="fox-live-match" key={`${room.serverType}-${room.serverId}-${room.roomId}-${room.createTime}`}>
      <td><div className="fox-record-name"><strong>{player.nickname}</strong><span className="fox-live-tag">{t('Watching live')}</span></div></td>
      <td>{snapshot ? t('{count} moves', { count: snapshot.moves.length }) : '—'}</td>
      <td><button type="button" onClick={() => connect(room)} disabled={selected && ['connecting', 'reconnecting'].includes(live.phase)}>{t('Watch live game')}</button></td>
    </tr>)}
    {(error || (selected && (live.error || live.phase !== 'idle'))) && <tr className="fox-live-feedback"><td colSpan={3}>
      {selected && live.phase !== 'idle' && <p role="status">{t(phaseLabels[live.phase])}</p>}
      {(error || live.error) && <p className="fox-import-error" role="alert">{error ? t(error.message, error.vars) : t(live.error!)}</p>}
      {snapshot && foxImportOptions({ KM: [snapshot.komi], RU: [snapshot.rules] }).needsConfirmation && <FoxLivePreview key={snapshot.chessId} snapshot={snapshot} phase={live.phase} onWatch={options => watch(snapshot, options)} onStop={live.stop} />}
    </td></tr>}
  </>;

}

function FoxLivePreview({ snapshot, phase, onWatch, onStop }: { snapshot: FoxLiveSnapshot; phase: string; onWatch(options: FoxImportOptions): void; onStop(): void }) {
  const t = useT();
  const [options, setOptions] = useState(() => foxImportOptions({ KM: [snapshot.komi], RU: [snapshot.rules] }));
  return <section className="fox-import-detail">
    <h3>{t('{black} vs {white}', { black: snapshot.black, white: snapshot.white })}</h3>
    <p>{t('{count} moves', { count: snapshot.moves.length })}</p>
    <FoxImportSettings value={options} onChange={setOptions} />
    <div className="fox-import-actions"><button type="button" onClick={onStop}>{t('Stop observing')}</button><button type="button" className="fox-primary" disabled={!validFoxImportOptions(options) || phase === 'error' || phase === 'reconnecting'} onClick={() => onWatch(options)}>{t('Watch on board')}</button></div>
  </section>;
}
