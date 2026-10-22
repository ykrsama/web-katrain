import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useT, type TranslationVars } from '../i18n';
import { useInitialDialogFocus } from '../hooks/useInitialDialogFocus';
import { parseSgf } from '../utils/sgf';
import { FoxImportError, resolveFoxKomi, assertFoxMoveNodes } from '../utils/foxImport';
import './FoxSgfImport.css';

type Game = { chessid: string; black: string; white: string; date: string; moves: number | string };
type Page = { games: Game[]; count: number; next_cursor: string | null; can_request_next: boolean; user?: { uid: string; nickname: string }; uid: string };
type RecordData = { chessid: string; sgf: string; bytes: number; secure_transport?: boolean; info: { black: string; white: string; komi: string } };
type Notice = { key: string; vars?: TranslationVars; detail?: string };

export function FoxSgfImport({ open, onClose, returnFocus, onImport }: { open: boolean; onClose: () => void; returnFocus?: HTMLElement | null; onImport: (parsed: ReturnType<typeof parseSgf>, sourceName: string) => void }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('nickname');
  const [pages, setPages] = useState<Page[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [identity, setIdentity] = useState('');
  const [uid, setUid] = useState('');
  const [record, setRecord] = useState<RecordData | null>(null);
  const [komi, setKomi] = useState('');
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Notice | null>(null);
  const [error, setError] = useState<Notice | null>(null);
  const controller = useRef<AbortController | null>(null);
  const dialog = useInitialDialogFocus<HTMLDivElement>(open, { returnFocus });
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
      const response = await fetch(`/api/fox/${route}`, { signal: active.signal });
      const data = await response.json();
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
    else if (cause instanceof Error && cause.name === 'AbortError') setError({ key: 'Request cancelled or timed out. You can retry.' });
    else setError({ key: 'Could not load the Fox record.', detail: cause instanceof Error ? cause.message : String(cause) });
  }
  async function search() {
    setError(null); setMessage(null); setPages([]); setRecord(null); setIdentity(''); setUid(''); setReplace(false);
    if (mode === 'uid' && !/^[0-9]{1,32}$/.test(query.trim())) {
      setError({ key: 'Fox UID must contain 1–32 ASCII digits. Use nickname mode for numeric nicknames.' });
      return;
    }
    setBusy(true);
    try {
      const result = await request<Page>(`search?${new URLSearchParams({ q: query, mode })}`);
      const unique = [...new Map(result.games.map(game => [game.chessid, game])).values()];
      setPages([{ ...result, games: unique }]); setPageIndex(0); setUid(result.uid);
      setIdentity(`${result.user?.nickname || query} · UID ${result.uid}`);
      setMessage({ key: 'Fox returned {count} records; {unique} unique records on this page.', vars: { count: result.count, unique: unique.length } });
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
      setMessage({ key: 'Fox returned {count} records; {unique} new records after deduplication.', vars: { count: result.count, unique: unique.length } });
      if (!unique.length) {
        setPages(current => current.map((item, i) => i === pageIndex ? { ...item, can_request_next: false } : item));
        return;
      }
      setPages([...pages, { ...result, games: unique }]); setPageIndex(pageIndex + 1);
    } catch (cause) { report(cause); } finally { setBusy(false); }
  }
  async function select(chessid: string) {
    setBusy(true); setError(null); setRecord(null); setKomi(''); setReplace(false);
    try { setRecord(await request<RecordData>(`sgf?id=${encodeURIComponent(chessid)}`)); }
    catch (cause) { report(cause); } finally { setBusy(false); }
  }
  function importRecord() {
    if (!record || !replace) return;
    setError(null);
    try {
      const parsed = parseSgf(record.sgf);
      assertFoxMoveNodes(parsed.tree);
      const confirmedKomi = resolveFoxKomi(parsed.tree?.props.KM?.[0], komi);
      if (confirmedKomi !== undefined) {
        parsed.komi = confirmedKomi;
        if (parsed.tree) parsed.tree.props.KM = [String(confirmedKomi)];
      }
      onImport(parsed, `fox-${record.chessid}.sgf`);
      useGameStore.setState({ notification: { message: t('Imported Fox record: {black} vs {white} · {moves} moves · komi {komi}. Original download unchanged.', { black: record.info.black, white: record.info.white, moves: parsed.moves.length, komi: parsed.komi }), type: 'success' } });
      setMessage({ key: 'Imported {moves} moves. Replay starts at the beginning; use the navigation controls to advance.', vars: { moves: parsed.moves.length } });
      close();
    } catch (cause) { report(cause); }
  }

  return <>
    {open && <div className="fox-import-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialog} className="fox-import-dialog" role="dialog" aria-modal="true" aria-labelledby="fox-import-title" tabIndex={-1}>
        <header><div><h2 id="fox-import-title">{t('Public Fox records')}</h2><p>{t('Same-origin Fox import · Historical records only, not live observation')}</p></div><button type="button" aria-label={t('Close Fox import')} onClick={close}>{t('Close')}</button></header>
        <form className="fox-import-search" onSubmit={event => { event.preventDefault(); if (!busy) void search(); }}>
          <select aria-label={t('Fox search mode')} value={mode} onChange={event => setMode(event.target.value)} disabled={busy}><option value="nickname">{t('Nickname')}</option><option value="uid">UID</option></select>
          <input aria-label={t('Fox nickname or UID')} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Fox nickname or UID')} maxLength={120} required disabled={busy} />
          <button type="submit" disabled={busy}>{busy ? t('Requesting…') : t('Find records')}</button>
        </form>
        {identity && <p className="fox-import-identity">{identity}</p>}
        {error && <div role="alert" className="fox-import-error">{t(error.key, error.vars)}{error.detail && <details><summary>{t('Upstream details (original language)')}</summary><p>{error.detail}</p></details>}</div>}
        {message && <p role="status">{t(message.key, message.vars)}</p>}
        {page && <>
          <div className="fox-import-table-wrap"><table><thead><tr><th>{t('Black / White')}</th><th>{t('Date / Moves')}</th><th>{t('Actions')}</th></tr></thead><tbody>
            {page.games.map(game => <tr key={game.chessid} data-fox-chessid={game.chessid}>
              <td><strong>{game.black}</strong><br />{game.white}</td><td>{game.date}<br />{t('{count} moves', { count: game.moves })}</td>
              <td><button type="button" disabled={busy} onClick={() => void select(game.chessid)}>{t('Preview / import')}</button></td>
            </tr>)}
          </tbody></table></div>
          <nav aria-label={t('Fox record pagination')}><button type="button" disabled={busy || pageIndex === 0} onClick={() => { setPageIndex(pageIndex - 1); setRecord(null); }}>{t('Previous page')}</button><span>{t('Page {page} · {count} records', { page: pageIndex + 1, count: page.games.length })}</span><button type="button" disabled={busy || !page.can_request_next} onClick={() => void next()}>{t('Next page')}</button></nav>
        </>}
        {record && <section className="fox-import-detail">
          <h3>{t('{black} vs {white}', { black: record.info.black, white: record.info.white })}</h3><p>{t('Record {id} · {bytes} bytes · original komi KM[{komi}]', { id: record.chessid, bytes: record.bytes, komi: record.info.komi })}</p>
          {record.secure_transport === false && <p className="fox-import-warning">{t('Untrusted transport: this record used a legacy HTTP fallback. Verify its source before importing.')}</p>}
          <p className="fox-import-warning">{t('Original SGF: variations, handicap and komi have not been normalized.')}</p>
          {Math.abs(Number(record.info.komi)) >= 100 && <p className="fox-import-warning">{t('KM[{komi}] may use Fox-specific encoding. Confirm the komi before importing.', { komi: record.info.komi })}</p>}
          <label>{t('Import komi (points)')}<input aria-label={t('Import komi')} type="number" step="0.5" min="-99.5" max="99.5" value={komi} placeholder={t('Confirm encoded komi before entering a value')} onChange={event => setKomi(event.target.value)} /></label>
          <small>{t('Only the import copy is adjusted. Enter a verified value such as 7.5; 375 is not treated as 375 points. Downloads remain unchanged.')}</small>
          <label className="fox-import-confirm"><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)} />{t('Import replaces the current board. I have saved any game I want to keep.')}</label>
          <div className="fox-import-actions"><a href={`/api/fox/download/${record.chessid}.sgf`} download>{t('Download original SGF')}</a><button type="button" disabled={busy || !replace} onClick={importRecord}>{t('Import onto board')}</button></div>
        </section>}
        {!page && !busy && <p className="fox-import-hint">{t('Search by public nickname or UID. No Fox login is required, and local records are not uploaded.')}</p>}
      </div>
    </div>}
  </>;
}
