import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlindfoldBannerView } from '../src/components/BlindfoldBanner';
import type { BlindfoldSession } from '../src/utils/blindfold';

const ASK = '请说坐标（例如 四之十七）';

const session = (partial: Partial<BlindfoldSession>): BlindfoldSession => ({
  aiColor: 'white',
  announce: 'xy',
  phase: 'listening',
  transcript: null,
  lastPoint: null,
  mic: { status: 'ready', failure: null },
  message: null,
  resumeToken: 0,
  ...partial,
});

const render = (partial: Partial<BlindfoldSession>): string =>
  renderToStaticMarkup(
    <BlindfoldBannerView session={session(partial)} onResume={() => undefined} onLeave={() => undefined} />
  );

describe('the blindfold banner', () => {
  it('reports the microphone while the recogniser is still opening', () => {
    const html = render({ mic: { status: 'starting', failure: null }, message: ASK });

    expect(html).toContain('data-blindfold-mic="starting"');
    // The mode must not ask for a point it is not ready to hear.
    expect(html).not.toContain(ASK);
  });

  it('asks for a point and stops talking about the microphone once it is open', () => {
    const html = render({
      mic: { status: 'ready', failure: null },
      message: ASK,
    });

    expect(html).toContain(ASK);
    // A line that says the microphone works on every turn is just noise.
    expect(html).not.toContain('data-blindfold-mic=');
  });

  it('shows why the microphone is blocked and offers the way out', () => {
    const html = render({
      phase: 'error',
      mic: { status: 'blocked', failure: 'denied' },
      message: '麦克风不可用',
    });

    expect(html).toContain('data-blindfold-mic="blocked"');
    expect(html).toContain('data-blindfold-mic-failure="denied"');
    expect(html).toContain('麦克风不可用');
    expect(html).toContain('data-blindfold-banner="true"');
  });

  it('keeps the read-back point in front of the microphone state', () => {
    const html = render({
      phase: 'confirming',
      mic: { status: 'ready', failure: null },
      lastPoint: { text: '四之十七', from: 'player' },
    });

    expect(html).toContain('四之十七');
  });
});
