import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnalysisModelNotice } from '../src/components/AnalysisModelNotice';

describe('local test model notice', () => {
  const modelUrl = '/models/katago-small.bin.gz';

  it('keeps the warning and model chooser for the local test model', () => {
    const html = renderToStaticMarkup(<AnalysisModelNotice modelUrl={modelUrl} engineMode="local" onChooseModel={() => undefined} />);
    expect(html).toContain('Lightweight test model selected');
    expect(html).toContain('Choose model');
  });

  it('renders neither the warning nor the chooser for remote analysis', () => {
    expect(renderToStaticMarkup(<AnalysisModelNotice modelUrl={modelUrl} engineMode="remote" onChooseModel={() => undefined} />)).toBe('');
  });
});
