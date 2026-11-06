import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/index.css', 'utf8');

describe('phone engine status detail', () => {
  it('still drops the backend detail before the state word on a phone', () => {
    // The word is the point of the pill; "· WebGPU" is not.
    const at = css.indexOf('.analysis-command-bar__status-detail {\n      display: none;\n    }');
    expect(at).toBeGreaterThan(-1);
    const enclosing = css.lastIndexOf('@media', at);
    expect(css.slice(enclosing, css.indexOf('{', enclosing))).toContain('max-width: 640px');
  });
});
