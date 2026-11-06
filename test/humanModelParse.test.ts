import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseKataGoModelV8 } from '../src/engine/katago/loadModelV8';
import { KATAGO_HUMAN_MODEL_PATH } from '../src/engine/katago/modelDefaults';

// Parsing the full human net is opt-in; keep normal/deployment tests small.
const bundled = path.resolve(__dirname, '../public', KATAGO_HUMAN_MODEL_PATH);
const HUMAN_MODEL = fs.existsSync(bundled) ? bundled : path.resolve(__dirname, '../.external/katago-human-model.bin.gz');

describe.skipIf(process.env.ENGINE_TESTS !== '1' || !fs.existsSync(HUMAN_MODEL))('human SL model parsing', () => {
  it('parses the metadata encoder', () => {
    const raw = zlib.gunzipSync(fs.readFileSync(HUMAN_MODEL));
    const parsed = parseKataGoModelV8(new Uint8Array(raw));
    expect(parsed.metaEncoderVersion).toBe(1);
    expect(parsed.metaEncoder).toBeDefined();
    expect(parsed.metaEncoder!.numInputMetaChannels).toBe(192);
    expect(parsed.metaEncoder!.mul1.inChannels).toBe(192);
    expect(parsed.metaEncoder!.mul3.outChannels).toBe(parsed.trunk.trunkNumChannels);
    expect(parsed.numInputChannels).toBe(22);
    expect(parsed.numInputGlobalChannels).toBe(19);
    // The human net also carries the shortterm error heads that uncertainty needs.
    expect(parsed.scoreValueChannels).toBeGreaterThanOrEqual(6);
  }, 300000);
});
