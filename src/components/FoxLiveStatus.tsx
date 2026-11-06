import { FaStepForward, FaStop } from 'react-icons/fa';
import { useT } from '../i18n';
import { useFoxLiveStore } from '../store/foxLiveStore';

const labels = {
  connecting: 'Connecting to Fox…', reconnecting: 'Reconnecting to Fox…', connected: 'Watching live',
  ended: 'Fox live room closed', error: 'Fox live connection failed', idle: '',
};

/** Compact controls share the game information strip with the player names. */
export function FoxLiveStatus() {
  const t = useT();
  const live = useFoxLiveStore();
  if (!live.attached) return null;
  return <div className="fox-live-status" role="group" aria-label={t('Fox live observation')}>
    <span className={`fox-live-badge ${live.phase}`} role="status">{t(labels[live.phase])}</span>
    <button type="button" onClick={live.follow} aria-label={live.following ? t('Following latest move') : t('Follow latest move')} aria-pressed={live.following} title={live.following ? t('Following latest move') : t('Follow latest move')}>
      <FaStepForward aria-hidden="true" /><span>{live.following ? t('Following live') : t('Follow latest move')}</span>
    </button>
    <button type="button" onClick={live.stop}><FaStop aria-hidden="true" /><span>{t('Stop observing')}</span></button>
    {live.error && <span className="fox-live-status-error" role="alert">{t(live.error)}</span>}
  </div>;
}
