import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addFoxSearchHistory, FOX_SEARCH_HISTORY_LIMIT, readFoxSearchHistory, saveFoxSearchHistory, type FoxSearchEntry } from '../src/utils/foxSearchHistory';
import { readLocalStorage, writeLocalStorage } from '../src/utils/storage';
vi.mock('../src/utils/storage', () => ({ readLocalStorage: vi.fn(), writeLocalStorage: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe('local Fox search history', () => {
  it('moves repeat searches to the front in one bounded recent list', () => {
    const entries: FoxSearchEntry[] = [{ query: '123' }, { query: 'cat' }];
    expect(addFoxSearchHistory(entries, entries[1])).toEqual([entries[1], entries[0]]);
    expect(addFoxSearchHistory(Array.from({ length: FOX_SEARCH_HISTORY_LIMIT }, (_, i) => ({ query: String(i) })), { query: 'cat' })).toHaveLength(FOX_SEARCH_HISTORY_LIMIT);
  });
  it('merges earlier nickname and UID history without losing searches', () => {
    vi.mocked(readLocalStorage).mockReturnValue('[{"query":"123","mode":"uid"},{"query":"123","mode":"nickname"},{"query":"cat","mode":"nickname"}]');
    expect(readFoxSearchHistory()).toEqual([{ query: '123' }, { query: 'cat' }]);
  });
  it('persists removal and clearing across reopen', () => {
    const entries: FoxSearchEntry[] = [{ query: 'cat' }];
    saveFoxSearchHistory(entries);
    vi.mocked(readLocalStorage).mockReturnValue(vi.mocked(writeLocalStorage).mock.lastCall![1]);
    expect(readFoxSearchHistory()).toEqual(entries);
    saveFoxSearchHistory([]);
    vi.mocked(readLocalStorage).mockReturnValue(vi.mocked(writeLocalStorage).mock.lastCall![1]);
    expect(readFoxSearchHistory()).toEqual([]);
  });
  it('ignores broken, duplicate and invalid stored records', () => {
    for (const value of ['invalid json', '{}', '[null,{}, {"query":" ","mode":"uid"}]']) {
      vi.mocked(readLocalStorage).mockReturnValue(value); expect(readFoxSearchHistory()).toEqual([]);
    }
    vi.mocked(readLocalStorage).mockReturnValue('[{"query":"cat","mode":"nickname"},{"query":"cat","mode":"nickname"},{"query":"x","mode":"bad"}]');
    expect(readFoxSearchHistory()).toEqual([{ query: 'cat' }]);
  });
});
