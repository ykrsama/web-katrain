import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RightPanel } from '../src/components/layout/RightPanel';
import { defaultUiState } from '../src/components/layout/types';
import { useGameStore } from '../src/store/gameStore';

const noop = () => undefined;
function renderPanel(overrides: Partial<ComponentProps<typeof RightPanel>> = {}) {
  const state = useGameStore.getInitialState();
  const ui = defaultUiState();
  return renderToStaticMarkup(<RightPanel
    {...state}
    open
    onClose={noop}
    isMobile
    activeMobileTab="info"
    mode="analyze"
    setMode={noop}
    modePanels={{ ...ui.panels.analyze, notesOpen: false, infoOpen: false, candidatesOpen: false }}
    analysisControls={ui.analysisControls.analyze}
    updatePanels={noop}
    updateControls={noop}
    onOpenGameAnalysis={noop}
    onOpenGameReport={noop}
    toast={noop}
    hoveredCandidateKey={null}
    onHoverCandidate={noop}
    winRate={null}
    scoreLead={null}
    pointsLost={null}
    engineDot="bg-green-400"
    engineMeta="Ready"
    engineMetaTitle={undefined}
    engineModelLabel={null}
    requestedBackend="webgpu"
    modelUrl="/models/katago-small.bin.gz"
    statusText="Ready"
    lockAiDetails={false}
    {...overrides}
  />);
}

describe('mobile review analysis graph', () => {
  it('mounts the score and win-rate graph inside the expanded Analysis section', () => {
    const html = renderPanel();
    expect(html).toContain('data-mobile-analysis-graph="true"');
    expect(html).toContain('h-44 min-h-44 shrink-0');
    expect(html).toContain('data-analysis-score-winrate-graph="true"');
    expect(html).toContain('Analysis graph. No analyzed moves yet.');
    // Both curves are mounted even when no evaluation exists yet.
    const graph = html.slice(html.indexOf('data-mobile-analysis-graph="true"'));
    expect(graph.match(/vector-effect="non-scaling-stroke"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('also shows the graph when Review is opened from Play mode', () => {
    expect(renderPanel({ mode: 'play' })).toContain('data-mobile-analysis-graph="true"');
  });

  it('does not mount the mobile graph on the Tree tab or in the desktop panel', () => {
    expect(renderPanel({ activeMobileTab: 'tree' })).not.toContain('data-mobile-analysis-graph="true"');
    expect(renderPanel({ isMobile: false })).not.toContain('data-mobile-analysis-graph="true"');
  });

  it('hides the graph with the rest of a collapsed Analysis section', () => {
    expect(renderPanel({ modePanels: { ...defaultUiState().panels.analyze, analysisOpen: false } }))
      .not.toContain('data-mobile-analysis-graph="true"');
  });
});
