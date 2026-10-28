import { describe, expect, it } from 'vitest';
import {
  TRICK_LOSS_THRESHOLD,
  evaluateTrickReplies,
  summarizeTrickRow,
  type TrickMoveMark,
  type TrickReply,
} from '../src/utils/trickMoves';

const point = (x: number, y: number, secondLoss = 3): TrickMoveMark => ({ x, y, secondLoss });

const reply = (scoreLead: number, winRate: number): TrickReply => ({ scoreLead, winRate });

/** A position where Black is to move and holds 50%: White, the opponent, is at 50% too. */
const baseline = 0.5;

describe('trick-move criterion', () => {
  it('flags a trap: one reply holds, the second costs points and winrate', () => {
    // Black played the trick, so White is the one replying. Black-perspective
    // values: White's bad reply raises Black's lead and Black's winrate.
    const evaluation = evaluateTrickReplies({
      replies: [reply(0, 0.45), reply(5, 0.55)],
      rootScoreLead: 0,
      baselineWinRate: baseline,
      mover: 'white',
    });

    expect(evaluation.topLoss).toBe(0);
    expect(evaluation.secondLoss).toBe(5);
    // White's winrate after their second choice (45%) is below their 50% now.
    expect(evaluation.winRateDrop).toBeCloseTo(0.05, 10);
    expect(evaluation.isTrick).toBe(true);
  });

  it('does not flag it when the second reply keeps their winrate', () => {
    // Score-wise the same as above, but White is no worse off after their
    // second choice than before Black moved -- that is a good move, not a trap.
    const evaluation = evaluateTrickReplies({
      replies: [reply(0, 0.45), reply(5, 0.45)],
      rootScoreLead: 0,
      baselineWinRate: baseline,
      mover: 'white',
    });

    expect(evaluation.secondLoss).toBe(5);
    expect(evaluation.winRateDrop).toBeCloseTo(-0.05, 10);
    expect(evaluation.isTrick).toBe(false);
  });

  it('reads Black replying with the same sign', () => {
    // White played the trick; Black replies. A bad reply for Black lowers the
    // black-perspective score and Black's winrate: 45%, below the 50% they
    // hold now.
    const evaluation = evaluateTrickReplies({
      replies: [reply(0, 0.45), reply(-5, 0.45)],
      rootScoreLead: 0,
      baselineWinRate: baseline,
      mover: 'black',
    });

    expect(evaluation.secondLoss).toBe(5);
    expect(evaluation.winRateDrop).toBeCloseTo(0.05, 10);
    expect(evaluation.isTrick).toBe(true);
  });

  it('still requires the second reply to lose the points', () => {
    const evaluation = evaluateTrickReplies({
      replies: [reply(0, 0.45), reply(2, 0.55)],
      rootScoreLead: 0,
      baselineWinRate: baseline,
      mover: 'white',
    });

    expect(evaluation.secondLoss).toBe(2);
    expect(evaluation.winRateDrop).toBeGreaterThan(0);
    expect(evaluation.isTrick).toBe(false);
  });

  it('does not flag a lost position, where even the best reply loses points', () => {
    const evaluation = evaluateTrickReplies({
      replies: [reply(-5, 0.45), reply(-12, 0.45)],
      rootScoreLead: 2,
      baselineWinRate: baseline,
      mover: 'black',
    });

    expect(evaluation.topLoss).toBe(7);
    expect(evaluation.secondLoss).toBe(14);
    expect(evaluation.isTrick).toBe(false);
  });

  it('needs the top two replies', () => {
    expect(evaluateTrickReplies({ replies: [reply(0, 0.45)], rootScoreLead: 0, baselineWinRate: baseline, mover: 'black' }))
      .toMatchObject({ topLoss: 0, secondLoss: null, winRateDrop: null, isTrick: false });
    expect(evaluateTrickReplies({ replies: [], rootScoreLead: 0, baselineWinRate: baseline, mover: 'black' }))
      .toMatchObject({ secondLoss: null, winRateDrop: null, isTrick: false });
  });

  it('ignores replies the engine could not score', () => {
    const evaluation = evaluateTrickReplies({
      replies: [reply(0, 0.45), reply(Number.NaN, 0.55), reply(5, 0.55)],
      rootScoreLead: 0,
      baselineWinRate: baseline,
      mover: 'white',
    });
    // The invalid entry is dropped, so the second valid reply is the -5 one.
    expect(evaluation.secondLoss).toBe(5);
    expect(evaluation.isTrick).toBe(true);
  });

  it('uses three points as the default threshold', () => {
    expect(TRICK_LOSS_THRESHOLD).toBe(3);
    const atThreshold = evaluateTrickReplies({
      replies: [reply(0, 0.45), reply(3, 0.55)],
      rootScoreLead: 0,
      baselineWinRate: baseline,
      mover: 'white',
    });
    expect(atThreshold.isTrick).toBe(true);
    const below = evaluateTrickReplies({
      replies: [reply(0, 0.45), reply(2.9, 0.55)],
      rootScoreLead: 0,
      baselineWinRate: baseline,
      mover: 'white',
    });
    expect(below.isTrick).toBe(false);
  });
});

describe('trick-move row', () => {
  const columns = 'ABCDEFGHJKLMNOPQRST';
  const formatPoint = (x: number, y: number) => `${columns[x]}${19 - y}`;

  it('shows the button and what it will do before a scan', () => {
    const row = summarizeTrickRow({ running: false, done: 0, total: 0, marks: null, formatPoint });
    expect(row.status).toBe('idle');
    expect(row.buttonLabel).toBe('Trick moves');
    expect(row.summary).toContain('second choice');
  });

  it('counts progress while the scan runs', () => {
    const row = summarizeTrickRow({ running: true, done: 3, total: 12, marks: null, formatPoint });
    expect(row.status).toBe('running');
    expect(row.buttonLabel).toBe('Stop');
    expect(row.summary).toContain('3/12');
  });

  it('says so when nothing was found', () => {
    const row = summarizeTrickRow({ running: false, done: 4, total: 4, marks: [], formatPoint });
    expect(row.status).toBe('ready');
    expect(row.summary).toBe('No trick moves here.');
  });

  it('lists the points that were found', () => {
    const row = summarizeTrickRow({
      running: false,
      done: 4,
      total: 4,
      marks: [point(15, 3), point(3, 15)],
      formatPoint,
    });
    expect(row.summary).toBe('2 trick moves: Q16, D4');
  });
});
