import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { validateSpeciesShape, validateBehaviorsShape } from '../src/core/data/validate';
const load = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const species = load('../src/species/bernese-mountain-dog/species.json');
const schema = new Ajv({ strict: false }).compile(load('../src/core/data/schema/species.schema.json'));
assert.deepEqual(validateSpeciesShape(species), []);
for (const id of ['graybox', 'graybox-shy', 'graybox-swift']) {
  assert.deepEqual(validateSpeciesShape(load(`../src/species/${id}/species.json`)), []);
}
const valid = species.resources.sprites;
const invalid = [
  null, [], {}, { format: 'sheet-row' }, { ...valid, clips: null },
  { ...valid, format: 'frame-files' }, { ...valid, extra: true },
  { ...valid, defaults: [] }, { ...valid, defaults: { loop: 'yes' } },
  { ...valid, defaults: { facing: 1 } }, { ...valid, defaults: { facing: 'up' } },
  { ...valid, defaults: { baselineY: -1 } }, { ...valid, defaults: { frameWidth: 0 } },
  { ...valid, defaults: { anchor: [0] } }, { ...valid, defaults: { baselineY: '60' } },
  ...[null, {}, { src: '', frames: 4, fps: 6 }, { src: 'idle.png', frames: 0, fps: 6 },
    { src: 'idle.png', frames: 1.5, fps: 6 }, { src: 'idle.png', frames: 4, fps: 0.09 },
    { src: 'idle.png', frames: 4, fps: 61 },
    { src: 'idle.png', frames: 4, fps: 6, facing: 'up' },
    { src: 'idle.png', frames: 4, fps: 6, loop: 1 },
    { src: 'idle.png', frames: 4, fps: 6, extra: true },
  ].map(clip => ({ ...valid, clips: { idle: clip } })),
];
for (const sprites of invalid) {
  const payload = { ...species, resources: { ...species.resources, sprites } };
  assert.equal(schema(payload), false, JSON.stringify(sprites));
  assert.ok(validateSpeciesShape(payload).some(e => e.includes('resources.sprites')), JSON.stringify(sprites));
}
const broken = structuredClone(species);
broken.personality.temperament.energy = 2;
broken.affection.annoyance.leaveAt = 1;
const errors = validateSpeciesShape(broken);
assert.ok(errors.some(e => e.includes('temperament.energy')));
assert.ok(errors.some(e => e.includes('leaveAt')));
assert.ok(validateBehaviorsShape({ stateWeights: { Idle: -1 } }).length);
console.log('Sprite validation and legacy validation regressions passed');

// Exercise the actual animation clock against the supplied idle sheet's frame count.
const { AnimationSystem } = await import('../src/core/animation/AnimationSystem');
const registry = readFileSync(new URL('../src/species/index.ts', import.meta.url), 'utf8');
assert.match(registry, /export const DEFAULT_SPECIES_ID = 'graybox';/);
const animation = new AnimationSystem(species);
const seen = new Set<number>();
for (let i = 0; i < 100; i++) {
  const state = animation.update(100, { moving: false, speedRatio: 0, arousal: 0, alertness: 0 },
    { stateId: 'Idle', speedPxPerSec: 0, moving: false });
  seen.add(state.frameIndex);
}
assert.equal(seen.size, species.resources.sprites.clips.idle.frames);
console.log(`Default graybox and idle clock passed (${seen.size} frames)`);
