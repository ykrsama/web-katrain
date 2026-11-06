import fs from 'node:fs';
import path from 'node:path';

/** UI fixtures keep the games, but do not preload megabytes of cached search results. */
export function withoutCachedAnalysis(sgf) {
  const valueEnd = start => {
    for (let i = start + 1; i < sgf.length; i++) {
      if (sgf[i] === '\\') i++;
      else if (sgf[i] === ']') return i + 1;
    }
    throw new Error('Unclosed SGF value in viewport game fixture');
  };
  const parts = [];
  let copied = 0;
  for (let i = 0; i < sgf.length;) {
    if (sgf[i] === '[') { i = valueEnd(i); continue; }
    if (!/[A-Za-z]/.test(sgf[i])) { i++; continue; }
    const start = i;
    while (i < sgf.length && /[A-Za-z]/.test(sgf[i])) i++;
    if (sgf.slice(start, i) !== 'KT') continue;
    let end = i;
    while (end < sgf.length && /\s/.test(sgf[end])) end++;
    if (sgf[end] !== '[') continue;
    do {
      end = valueEnd(end);
      while (end < sgf.length && /\s/.test(sgf[end])) end++;
    } while (sgf[end] === '[');
    parts.push(sgf.slice(copied, start));
    copied = end;
    i = end;
  }
  parts.push(sgf.slice(copied));
  return parts.join('');
}

/** Used only by test:viewport's dev server; production assets are untouched. */
export function viewportGameFixtures(root) {
  const gameDirectory = path.resolve(root, 'src/data/sgf') + path.sep;
  return {
    name: 'viewport-game-fixtures',
    enforce: 'pre',
    load(id) {
      const [file, query = ''] = id.split('?');
      if (!file.startsWith(gameDirectory) || !file.endsWith('.sgf') || !new URLSearchParams(query).has('raw')) return;
      return `export default ${JSON.stringify(withoutCachedAnalysis(fs.readFileSync(file, 'utf8')))};`;
    },
  };
}
