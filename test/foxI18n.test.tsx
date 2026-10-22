import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { FoxSgfImport } from '../src/components/FoxSgfImport';
import { useGameStore } from '../src/store/gameStore';
import { zhMessages } from '../src/i18n/zh';
import fox from '../src/i18n/zh/fox';
import { translate } from '../src/i18n/translate';
import baseline from './fox-i18n-baseline.json';

describe('Fox import locale integration', () => {
  it('preserves every existing catalogue module and cannot shadow a prior key', () => {
    const existing: Record<string, string> = {};
    const moduleOrder = [...baseline['src/i18n/zh/index.ts'].matchAll(/import \w+ from '\.\/(\w+)'/g)].map(match => `src/i18n/zh/${match[1]}.ts`);
    for (const path of moduleOrder) {
      const source = baseline[path as keyof typeof baseline];
      expect(readFileSync(path, 'utf8')).toBe(source);
      const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && ts.isStringLiteral(node.initializer)) existing[node.name.text] = node.initializer.text;
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
    expect(Object.keys(fox).filter(key => Object.hasOwn(existing, key))).toEqual([]);
    for (const [key, value] of Object.entries(existing)) expect(zhMessages[key]).toBe(value);
  });
  it('keeps placeholder names aligned and uses the existing English fallback', () => {
    const vars = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const [key, value] of Object.entries(fox)) {
      expect(vars(value)).toEqual(vars(key));
      expect(translate('en', key)).toBe(key);
      expect(translate('zh', key)).toBe(value);
      expect(translate('ja', key)).toBe(key);
    }
  });
  it('renders real dialog labels through the live useT locale selector', () => {
    const original = useGameStore.getInitialState();
    const originalLocale = original.settings.appLocale;
    const stateBefore = useGameStore.getState();
    try {
      for (const locale of ['en', 'zh'] as const) {
        original.settings.appLocale = locale;
        useGameStore.setState({ settings: { ...stateBefore.settings, appLocale: locale } });
        const html = renderToStaticMarkup(<FoxSgfImport open onClose={() => undefined} onImport={() => undefined} />);
        expect(html).toContain(locale === 'en' ? 'Public Fox records' : '野狐公开棋谱');
        expect(html).toContain(locale === 'en' ? 'Find records' : '查询棋谱');
        expect(html).not.toContain('fox-import-launcher');
        if (locale === 'en') expect(html).not.toMatch(/[\u3400-\u9fff]/);
      }
    } finally { original.settings.appLocale = originalLocale; useGameStore.setState(stateBefore); }
  });
});
