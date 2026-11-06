import React, { Suspense } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createWarmableLazy } from '../src/utils/warmableLazy';

const Dialog: React.FC<{ title: string }> = ({ title }) => <div data-real="true">{title}</div>;

describe('createWarmableLazy', () => {
  it('renders without suspending once the chunk is warm', async () => {
    const chunk = createWarmableLazy(
      () => Promise.resolve({ Dialog }),
      (module) => module.Dialog,
    );

    expect(chunk.isWarm()).toBe(false);
    await chunk.warm();
    expect(chunk.isWarm()).toBe(true);

    // No Suspense boundary here on purpose. React.lazy would suspend even with
    // its module already imported -- the payload is not initialised until React
    // renders it -- and a committed fallback is what React then throttles, at a
    // measured ~300ms whether the chunk is 7KB or 94KB. Rendering the component
    // itself is what removes the wait, so this must not need a boundary.
    const markup = renderToStaticMarkup(<chunk.Component title="Settings" />);

    expect(markup).toContain('data-real="true"');
    expect(markup).toContain('Settings');
  });

  it('still works through Suspense before warming has finished', () => {
    const chunk = createWarmableLazy(
      () => Promise.resolve({ Dialog }),
      (module) => module.Dialog,
    );

    // A click can beat the warmer. That path is the ordinary lazy one, so it
    // needs a boundary and shows the fallback -- which is why LazyModalFallback
    // still exists.
    const markup = renderToStaticMarkup(
      <Suspense fallback={<div data-fallback="true">Opening…</div>}>
        <chunk.Component title="Settings" />
      </Suspense>
    );

    expect(markup).toContain('data-fallback="true"');
  });

  it('does not change component identity under a mounted dialog', async () => {
    // The choice is frozen per mount. Read at render time instead, a dialog
    // opened before warming resolved would change element type mid-life, and
    // React unmounts and remounts on a changed type -- throwing away whatever
    // someone had typed into it.
    const chunk = createWarmableLazy(
      () => Promise.resolve({ Dialog }),
      (module) => module.Dialog,
    );

    const source = (await import('node:fs')).readFileSync('src/utils/warmableLazy.ts', 'utf8');
    expect(source).toContain('React.useState');
    expect(source).not.toMatch(/return React\.createElement\(resolved \?\? Lazy/);

    await chunk.warm();
    expect(chunk.isWarm()).toBe(true);
  });
});

describe('the warm list in Layout', () => {
  it('covers every dialog that was made warmable', async () => {
    // A dialog wired through createWarmableLazy but left out of the list is
    // the worst of both: it still carries the wrapper, and it still opens in
    // ~300ms because nothing ever warms it. Nothing else would notice.
    const layout = (await import('node:fs')).readFileSync('src/components/Layout.tsx', 'utf8');

    const declared = [...layout.matchAll(/const (\w+Chunk) = createWarmableLazy\(/g)].map((m) => m[1]!);
    expect(declared.length).toBeGreaterThan(10);

    const listStart = layout.indexOf('const WARMED_DIALOG_CHUNKS');
    const listEnd = layout.indexOf('];', listStart);
    expect(listStart).toBeGreaterThan(-1);
    const list = layout.slice(listStart, listEnd);

    const missing = declared.filter((name) => !list.includes(`${name}.warm`));
    expect(missing, `not warmed: ${missing.join(', ')}`).toEqual([]);
  });
});
