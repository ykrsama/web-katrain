import { useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useT } from '../i18n';
import type { FoxSearchEntry } from '../utils/foxSearchHistory';

export function FoxSearchField({ query, setQuery, history, onHistoryChange, onSelect, disabled, inputRef }: {
  query: string; setQuery(query: string): void;
  history: FoxSearchEntry[]; onHistoryChange(entries: FoxSearchEntry[]): void; onSelect(query: string): void; disabled: boolean; inputRef: RefObject<HTMLInputElement | null>;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const entries = history.filter(item => item.query.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const label = t('Search Fox players');
  return (
    <div className="fox-search-field" ref={wrapper} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false); }} onKeyDown={event => {
      if (event.key === 'Escape' && expanded) { event.stopPropagation(); inputRef.current?.focus(); setExpanded(false); }
    }}>
      <div className="fox-search-input">
        <input ref={inputRef} aria-label={label} aria-expanded={expanded && entries.length > 0} aria-controls="fox-search-history" autoComplete="off" value={query} onChange={event => { setQuery(event.target.value); setExpanded(true); }} onFocus={() => setExpanded(true)} onClick={() => setExpanded(true)} onKeyDown={event => {
          if (event.key === 'ArrowDown' && entries.length) { event.preventDefault(); setExpanded(true); requestAnimationFrame(() => wrapper.current?.querySelector<HTMLButtonElement>('.fox-search-history li button')?.focus()); }
        }} placeholder={label} maxLength={120} required disabled={disabled} />
        {history.length > 0 && <button type="button" disabled={disabled} aria-label={t('Search history')} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>▾</button>}
      </div>
      {expanded && entries.length > 0 && <section className="fox-search-history" id="fox-search-history" aria-label={t('Search history')}>
        <div><span>{t('Search history')}</span><button type="button" onClick={() => onHistoryChange([])}>{t('Clear search history')}</button></div>
        <ul>{entries.map(entry => <li key={entry.query}>
          <button type="button" disabled={disabled} onClick={() => { setQuery(entry.query); inputRef.current?.focus(); setExpanded(false); onSelect(entry.query); }}>{entry.query}</button>
          <button type="button" aria-label={t('Delete search: {query}', { query: entry.query })} onClick={() => onHistoryChange(history.filter(item => item !== entry))}>×</button>
        </li>)}</ul>
      </section>}
    </div>
  );
}
