import { describe, expect, it } from 'vitest';
import {
  SAVAGE_LOSS_THRESHOLD,
  evaluateSavageReplies,
  summarizeSavageRow,
  type SavageMoveMark,
} from '../src/utils/savageMoves';

const point = (x: number, y: number, secondLoss = 3): SavageMoveMark => ({ x, y, secondLoss });

describe('savage-move criterion', () => {
  it('flags a position whose second-best reply already loses the threshold', () => {
    // Black to move: the replies are black-perspective scores after each answer.
    const evaluation = evaluateSavageReplies({
      scores: [0, -5],
      rootScoreLead: 0,
      mover: 'black',
    });

    expect(evaluation.topLoss).toBe(0);
    expect(evaluation.secondLoss).toBe(5);
    expect(evaluation.isSavage).toBe(true);
  });

  it('does not flag a position with two replies that hold', () => {
    const evaluation = evaluateSavageReplies({
      scores: [0, -2],
      rootScoreLead: 0,
      mover: 'black',
    });

    expect(evaluation.secondLoss).toBe(2);
    expect(evaluation.isSavage).toBe(false);
  });

  it('reads white scores with the same sign as the engine reports them', () => {
    // The engine reports black-perspective values. For White to move a good
    // reply leaves Black's lead where it is, and a bad reply raises it.
    const evaluation = evaluateSavageReplies({
      scores: [0, 5],
      rootScoreLead: 0,
      mover: 'white',
    });

    expect(evaluation.topLoss).toBe(0);
    expect(evaluation.secondLoss).toBe(5);
    expect(evaluation.isSavage).toBe(true);
  });

  it('does not flag a lost position, where even the best reply loses points', () => {
    const evaluation = evaluateSavageReplies({
      scores: [-5, -12],
      rootScoreLead: 2,
      mover: 'black',
    });

    expect(evaluation.topLoss).toBe(7);
    expect(evaluation.secondLoss).toBe(14);
    expect(evaluation.isSavage).toBe(false);
  });

  it('needs a second reply to compare against', () => {
    expect(evaluateSavageReplies({ scores: [0], rootScoreLead: 0, mover: 'black' }))
      .toMatchObject({ topLoss: 0, secondLoss: null, isSavage: false });
    expect(evaluateSavageReplies({ scores: [], rootScoreLead: 0, mover: 'black' }))
      .toMatchObject({ secondLoss: null, isSavage: false });
  });

  it('ignores non-finite scores instead of calling them a loss', () => {
    const evaluation = evaluateSavageReplies({
      scores: [0, Number.NaN, -5],
      rootScoreLead: 0,
      mover: 'black',
    });
    expect(evaluation.secondLoss).toBe(5);
    expect(evaluation.isSavage).toBe(true);
  });

  it('uses three points as the default threshold', () => {
    expect(SAVAGE_LOSS_THRESHOLD).toBe(3);
    const atThreshold = evaluateSavageReplies({ scores: [0, -3], rootScoreLead: 0, mover: 'black' });
    expect(atThreshold.isSavage).toBe(true);
    const below = evaluateSavageReplies({ scores: [0, -2.9], rootScoreLead: 0, mover: 'black' });
    expect(below.isSavage).toBe(false);
  });
});

describe('savage-move row', () => {
  const columns = 'ABCDEFGHJKLMNOPQRST';
  const formatPoint = (x: number, y: number) => `${columns[x]}${19 - y}`;

  it('shows the button and what it will do before a scan', () => {
    const row = summarizeSavageRow({ running: false, done: 0, total: 0, marks: null, formatPoint });
    expect(row.status).toBe('idle');
    expect(row.buttonLabel).toBe('Find savage moves');
    expect(row.summary).toContain('only one good reply');
  });

  it('counts progress while the scan runs', () => {
    const row = summarizeSavageRow({ running: true, done: 3, total: 12, marks: null, formatPoint });
    expect(row.status).toBe('running');
    expect(row.buttonLabel).toBe('Stop');
    expect(row.summary).toContain('3/12');
  });

  it('says so when nothing was found', () => {
    const row = summarizeSavageRow({ running: false, done: 4, total: 4, marks: [], formatPoint });
    expect(row.status).toBe('ready');
    expect(row.summary).toBe('No savage moves here.');
  });

  it('lists the points that were found', () => {
    const row = summarizeSavageRow({
      running: false,
      done: 4,
      total: 4,
      marks: [point(15, 3), point(3, 15)],
      formatPoint,
    });
    expect(row.summary).toBe('2 savage moves: Q16, D4');
  });
});
