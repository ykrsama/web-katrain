import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useT, type TranslationVars } from '../i18n';
import { useBackGestureToClose } from '../hooks/useEscapeToClose';
import { useInitialDialogFocus } from '../hooks/useInitialDialogFocus';
import { parseSgf } from '../utils/sgf';
import { FoxImportError, assertFoxMoveNodes } from '../utils/foxImport';
import { foxApiUrl } from '../utils/foxApi';
import type { FoxPage as Page, FoxRecord as RecordData, FoxUser } from '../types/fox';
import { FoxLiveRecords } from './FoxLiveRecords';
import { useFoxLiveStore } from '../store/foxLiveStore';
import { FoxImportSettings } from './FoxImportSettings';
import { FoxSearchField } from './FoxSearchField';
import { applyFoxImportOptions, foxImportOptions, validFoxImportOptions, type FoxImportOptions } from '../utils/foxImportOptions';
import { addFoxSearchHistory, readFoxSearchHistory, saveFoxSearchHistory } from '../utils/foxSearchHistory';
import './FoxSgfImport.css';

type Notice = { key: string; vars?: TranslationVars; detail?: string };

export function FoxSgfImport({ open, onClose, returnFocus, onImport }: { open: boolean; onClose: () => void; returnFocus?: HTMLElement | null; onImport: (parsed: ReturnType<typeof parseSgf>, sourceName: string) => void }) {
  const t = useT();
  const [player, setPlayer] = useState<FoxUser | null>(null);
  const [query, setQuery] = useState('');
  const [pages, setPages] = useState<Page[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [identity, setIdentity] = useState('');
  const [uid, setUid] = useState('');
  const [record, setRecord] = useState<RecordData | null>(null);
  const [options, setOptions] = useState<FoxImportOptions>(() => foxImportOptions({}));
  const [history, setHistory] = useState(readFoxSearchHistory);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Notice | null>(null);
  const controller = useRef<AbortController | null>(null);
  const queryInput = useRef<HTMLInputElement>(null);
  const dialog = useInitialDialogFocus<HTMLDivElement>(open, { returnFocus, initialFocusRef: queryInput });
  useBackGestureToClose(() => { controller.current?.abort(); setBusy(false); onClose(); }, open);
  const page = pages[pageIndex];

  const close = () => { controller.current?.abort(); setBusy(false); onClose(); };
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { controller.current?.abort(); setBusy(false); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  useEffect(() => () => controller.current?.abort(), []);

  async function request<T>(route: string): Promise<T> {
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    const timer = window.setTimeout(() => active.abort(), 65000);
    try {
      const response = await fetch(foxApiUrl(route), { signal: active.signal, cache: 'no-store', credentials: 'omit' });
      const data = await response.json();
      if (active.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!response.ok) {
        setError({ key: 'Fox request failed ({status}). Please retry later.', vars: { status: response.status }, detail: data.error });
        return Promise.reject(null);
      }
      return data;
    } finally { window.clearTimeout(timer); }
  }
  function report(cause: unknown) {
    if (cause === null) return; // A structured HTTP error has already been recorded.
    if (cause instanceof FoxImportError) setError({ key: cause.message, vars: cause.vars });
    else if (cause instanceof Error && cause.name === 'AbortError') setError({ key: 'Request canceled or timed out. You can retry.' });
    else setError({ key: 'Could not load the Fox record.', detail: cause instanceof Error ? cause.message : String(cause) });
  }
  async function search(searchText = query) {
    setError(null); setPages([]); setRecord(null); setIdentity(''); setUid('');
    setPlayer(null);
    setBusy(true);
    try {
      const searchQuery = searchText.trim();
      const user = await request<FoxUser>(`player?${new URLSearchParams({ q: searchQuery })}`);
      setHistory(current => {
        const updated = addFoxSearchHistory(current, { query: searchQuery });
        saveFoxSearchHistory(updated); return updated;
      });
      setPlayer(user); setUid(user.uid); setIdentity(user.nickname || searchQuery);
      const result = await request<Page>(`games?${new URLSearchParams({ uid: user.uid })}`);
      const unique = [...new Map(result.games.map(game => [game.chessid, game])).values()];
      setPages([{ ...result, games: unique }]); setPageIndex(0); setUid(result.uid);

    } catch (cause) { report(cause); } finally { setBusy(false); }
  }
  async function next() {
    if (!page?.next_cursor) return;
    if (pageIndex + 1 < pages.length) { setPageIndex(pageIndex + 1); setRecord(null); return; }
    setBusy(true); setError(null); setRecord(null);
    try {
      const result = await request<Page>(`games?${new URLSearchParams({ uid, cursor: page.next_cursor })}`);
      const seen = new Set(pages.flatMap(item => item.games.map(game => game.chessid)));
      const unique = result.games.filter(game => { if (seen.has(game.chessid)) return false; seen.add(game.chessid); return true; });

      if (!unique.length) {
        setPages(current => current.map((item, i) => i === pageIndex ? { ...item, can_request_next: false } : item));
        return;
      }
      setPages([...pages, { ...result, games: unique }]); setPageIndex(pageIndex + 1);
    } catch (cause) { report(cause); } finally { setBusy(false); }
  }
  async function select(chessid: string) {
    useFoxLiveStore.getState().stop();
    setBusy(true); setError(null); setRecord(null);
    try {
      const data = await request<RecordData>(`sgf?id=${encodeURIComponent(chessid)}`);
      const parsed = parseSgf(data.sgf);
      assertFoxMoveNodes(parsed.tree);
      const detected = foxImportOptions(parsed.tree?.props ?? {});
      if (detected.needsConfirmation) { setOptions(detected); setRecord(data); }
      else importRecord(data, detected);
    }
    catch (cause) { report(cause); } finally { setBusy(false); }
  }
  function importRecord(data = record, chosen = options) {
    if (!data || !validFoxImportOptions(chosen)) return;
    setError(null);
    try {
      const parsed = parseSgf(data.sgf);
      assertFoxMoveNodes(parsed.tree);
      applyFoxImportOptions(parsed, chosen);
      onImport(parsed, `fox-${data.chessid}.sgf`);
      useGameStore.setState({ notification: { message: t('Fox record imported.'), type: 'success' } });
      close();
    } catch (cause) { report(cause); }
  }

  return <>
    {open && <div className="fox-import-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialog} className="fox-import-dialog" role="dialog" aria-modal="true" aria-labelledby="fox-import-title" tabIndex={-1}>
        <header><div><h2 id="fox-import-title">{t('Fox records')}</h2><p>{t('Live observation and historical records')}</p></div><button type="button" aria-label={t('Close Fox records')} onClick={close}>{t('Close')}</button></header>
        <form className="fox-import-search" onSubmit={event => { event.preventDefault(); if (!busy) void search(); }}>
          <FoxSearchField query={query} setQuery={setQuery} history={history} onHistoryChange={entries => { setHistory(entries); saveFoxSearchHistory(entries); }} onSelect={value => void search(value)} disabled={busy} inputRef={queryInput} />
          <button type="submit" disabled={busy}>{busy ? t('Finding…') : t('Find records')}</button>
        </form>
        {identity && <p className="fox-import-identity">{identity}</p>}
        {error && <div role="alert" className="fox-import-error">{t(error.key, error.vars)}</div>}
        {(player || page) && <div className="fox-import-table-wrap"><table><thead><tr><th>{t('Black / White')}</th><th>{t('Date / Moves')}</th><th>{t('Actions')}</th></tr></thead><tbody>
            {player && <FoxLiveRecords key={player.uid} player={player} onImport={onImport} onClose={close} />}
            {page?.games.map(game => <tr key={game.chessid} data-fox-chessid={game.chessid}>
              <td><strong>{game.black}</strong><br />{game.white}</td><td>{game.date}<br />{t('{count} moves', { count: game.moves })}</td>
              <td><button type="button" disabled={busy} onClick={() => void select(game.chessid)}>{t('Import')}</button></td>
            </tr>)}
          </tbody></table></div>}
        {page && <nav aria-label={t('Fox record pagination')}><button type="button" disabled={busy || pageIndex === 0} onClick={() => { setPageIndex(pageIndex - 1); setRecord(null); }}>{t('Previous page')}</button><span>{t('Page {page} · {count} records', { page: pageIndex + 1, count: page.games.length + (player?.live?.length ?? 0) })}</span><button type="button" disabled={busy || !page.can_request_next} onClick={() => void next()}>{t('Next page')}</button></nav>
        }
        {record && <section className="fox-import-detail">
          <h3>{t('{black} vs {white}', { black: record.info.black, white: record.info.white })}</h3>
          <FoxImportSettings value={options} onChange={setOptions} />
          <div className="fox-import-actions"><button type="button" disabled={busy || !validFoxImportOptions(options)} onClick={() => importRecord()}>{t('Import onto board')}</button></div>
        </section>}
      </div>
    </div>}
  </>;
}
