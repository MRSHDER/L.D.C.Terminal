/**
 * L.D.C. — 引擎默认值（DEFAULT_SPECIES / DEFAULT_BEHAVIORS）
 */

import type {
  SpeciesData,
  BehaviorsData,
  Temperament,
  AnimationConfig,
  NeedsConfig,
  PreferencesConfig,
  LocomotionConfig,
  PhysicalConfig,
  CognitionConfig,
  ResourcesConfig,
  PersonalityConfig,
  AffectionConfig,
  RoomConfig,
  BondingConfig,
  PettingConfig,
  AnnoyanceConfig,
  SilhouetteConfig,
} from './types';
import { SPECIES_SCHEMA_VERSION, BEHAVIORS_SCHEMA_VERSION } from './types';

export const GRAYBOX_BASE_SIZE = { w: 48, h: 36 } as const;

const DEFAULT_TEMPERAMENT: Temperament = {
  gentleness: 0.5,
  energy: 0.5,
  curiosity: 0.5,
  stubbornness: 0.5,
  shyness: 0.5,
  clinginess: 0.5,
  playfulness: 0.5,
  obedience: 0.5,
  randomness: 0.35,
};

const DEFAULT_SILHOUETTE: SilhouetteConfig = {
  bodyLength: 1.08,
  chestDepth: 0.58,
  legLength: 0.78,
  headForward: 0.7,
  headSize: 0.48,
  snoutLength: 0.55,
  earShape: 'prick',
  earLength: 0.62,
  tailAttach: 0.1,
};

const DEFAULT_PHYSICAL: PhysicalConfig = {
  bodyScale: 1,
  hitbox: { w: GRAYBOX_BASE_SIZE.w, h: GRAYBOX_BASE_SIZE.h, anchorY: 0.85 },
  pettingHotspots: [],
  grayboxTint: 0xffffff,
  silhouette: DEFAULT_SILHOUETTE,
};

const DEFAULT_PERSONALITY: PersonalityConfig = {
  temperament: DEFAULT_TEMPERAMENT,
  traits: [],
};

const DEFAULT_COGNITION: CognitionConfig = {
  decisionIntervalMs: 500,
  reactionDelayMs: [200, 700],
  attentionSpanMs: 6000,
  memorySpanMs: 30000,
  learningRate: 0.15,
};

const DEFAULT_ANIMATION: AnimationConfig = {
  targetFps: 10,
  breath: { freqHz: 0.22, ampPx: 1.2, bodyScaleY: 0.016 },
  blink: { baseIntervalMs: 4200, varianceMs: 2200, durationMs: 140 },
  tail: { segments: 3, baseAngleDeg: 8, maxSwingDeg: 18, delayPerSegMs: 80 },
  ear: { jitterDeg: 4, triggerBias: 0.22 },
  float: { ampPx: 0.8, freqHz: 0.13 },
  transitions: {},
  defaultTransitionMs: 200,
};

const DEFAULT_NEEDS: NeedsConfig = {
  hunger: { decayPerMin: 0.9, criticalAt: 0.85, restorePerMin: 12 },
  energy: { decayPerMin: 0.6, criticalAt: 0.8, restorePerMin: 6 },
  social: { decayPerMin: 1.4, criticalAt: 0.75, restorePerMin: 8 },
};

const DEFAULT_PREFERENCES: PreferencesConfig = {
  food: { base: 0.7, favorites: [], dislikes: [] },
  toys: { ball: 0.5, rope: 0.5, squeaky: 0.5 },
  places: { nearPlayer: 0.6, sunnySpot: 0.5, underTable: 0.4 },
  touch: { head: 0.7, back: 0.7, belly: 0.5 },
};

const DEFAULT_LOCOMOTION: LocomotionConfig = {
  walkSpeedPx: 30,
  runSpeedPx: 65,
  turnRateDeg: 200,
  idleWanderRadiusPx: 48,
  wanderChancePerMin: 3,
  arriveThresholdPx: 3,
};

const DEFAULT_RESOURCES: ResourcesConfig = {
  assetRoot: '',
  animationClips: {},
};

const DEFAULT_BONDING: BondingConfig = {
  gainPerPet: 0.22,
  decayPerSec: 0.006,
  penaltyPerSecWhenAnnoyed: 0.05,
  ladder: [
    { atBond: 0.0, state: 'LookAt', label: { zh: '看向玩家', en: 'Looks at you' } },
    { atBond: 0.32, state: 'Approach', label: { zh: '靠近一点', en: 'Comes closer' } },
    { atBond: 0.55, state: 'Sit', label: { zh: '坐到你旁边', en: 'Sits beside you' } },
    { atBond: 0.76, state: 'WagTail', label: { zh: '摇尾巴', en: 'Wags tail' } },
    { atBond: 0.93, state: 'PetEnjoy', label: { zh: '闭眼享受', en: 'Closes eyes, content' } },
  ],
  requiresTouchToNotice: true,
};

const DEFAULT_PETTING: PettingConfig = {
  minEffectiveMs: 90,
  pleasureBase: 0.35,
  arousalGain: 0.28,
  tolerance: 3,
};

const DEFAULT_ANNOYANCE: AnnoyanceConfig = {
  windowMs: 3200,
  threshold: 7,
  annoyancePerExcess: 0.34,
  decayPerSec: 0.3,
  leaveAt: 0.78,
  sulkMs: 5200,
};

const DEFAULT_AFFECTION: AffectionConfig = {
  bonding: DEFAULT_BONDING,
  petting: DEFAULT_PETTING,
  annoyance: DEFAULT_ANNOYANCE,
};

const DEFAULT_ROOM: RoomConfig = {
  floorLineRatio: 0.74,
  floorColor: 0x1e1e26,
  floorShadeColor: 0x16161c,
  wallColor: 0x121218,
  showGrid: false,
  playerAnchor: { xRatio: 0.5, yRatio: 1.15 },
};

export const DEFAULT_SPECIES: SpeciesData = {
  $schema: SPECIES_SCHEMA_VERSION,
  version: '1.0.0',
  id: '__default__',
  displayName: { zh: '中性基准', en: 'Neutral Baseline' },
  catalogNo: 'LDC-000',
  description: { zh: '引擎默认值，不作为一个犬种出现。', en: 'Engine defaults. Not a real species.' },
  physical: DEFAULT_PHYSICAL,
  personality: DEFAULT_PERSONALITY,
  cognition: DEFAULT_COGNITION,
  animation: DEFAULT_ANIMATION,
  needs: DEFAULT_NEEDS,
  preferences: DEFAULT_PREFERENCES,
  locomotion: DEFAULT_LOCOMOTION,
  resources: DEFAULT_RESOURCES,
  affection: DEFAULT_AFFECTION,
  room: DEFAULT_ROOM,
};

export const CORE_STATE_IDS = ['Idle', 'Walk', 'Sit', 'Sleep'] as const;
export type CoreStateId = (typeof CORE_STATE_IDS)[number];

export const INTERACTION_STATE_IDS = [
  'LookAt',
  'Approach',
  'WagTail',
  'PetEnjoy',
  'Annoyed',
  'Retreat',
] as const;
export type InteractionStateId = (typeof INTERACTION_STATE_IDS)[number];

export const ALL_CORE_STATE_IDS = [...CORE_STATE_IDS, ...INTERACTION_STATE_IDS] as const;

const DEFAULT_STATE_WEIGHTS: Record<string, number> = {
  Idle: 40,
  Walk: 25,
  Sit: 18,
  Sleep: 10,
  Eat: 5,
  Play: 3,
  Watch: 2,
};

const DEFAULT_PERSONALITY_BIAS: BehaviorsData['personalityBias'] = {
  Walk: { energy: { sensitivity: 1.5 } },
  Sit: { energy: { sensitivity: -0.6 } },
  Sleep: { energy: { sensitivity: -1.2 } },
  Idle: { curiosity: { sensitivity: 0.3 } },
};

export const DEFAULT_BEHAVIORS: BehaviorsData = {
  $schema: BEHAVIORS_SCHEMA_VERSION,
  id: '__default__',
  stateWeights: DEFAULT_STATE_WEIGHTS,
  personalityBias: DEFAULT_PERSONALITY_BIAS,
  interactionResponse: {},
  microBehaviors: [],
  extraRandomness: 0,
  pettingResponse: {
    weights: { accept: 62, leanIn: 18, lookUp: 14, pullAway: 6 },
    cooldownMs: 0,
  },
  annoyanceResponse: {
    weights: { turnHeadAway: 48, standUp: 30, walkAway: 22 },
    cooldownMs: 0,
  },
  annoyanceBias: {
    gentleness: { sensitivity: -1.2 },
    stubbornness: { sensitivity: 0.9 },
  },
};

export interface ResolvedSilhouette {
  readonly torsoW: number;
  readonly torsoH: number;
  readonly legW: number;
  readonly legH: number;
  readonly legGap: number;
  readonly headW: number;
  readonly headH: number;
  readonly snoutW: number;
  readonly snoutH: number;
  readonly earW: number;
  readonly earH: number;
  readonly headForwardPx: number;
  readonly tailAttachPx: number;
  readonly earShape: SilhouetteConfig['earShape'];
}

export function resolveSilhouette(species: SpeciesData): ResolvedSilhouette {
  const scale = species.physical.bodyScale;
  const sil = species.physical.silhouette;
  const torsoW = Math.max(16, Math.round(GRAYBOX_BASE_SIZE.w * scale * sil.bodyLength));
  const torsoH = Math.max(10, Math.round(GRAYBOX_BASE_SIZE.h * scale * sil.chestDepth));
  const headW = Math.max(10, Math.round(GRAYBOX_BASE_SIZE.w * scale * sil.headSize * 0.72));
  const headH = Math.max(10, Math.round(GRAYBOX_BASE_SIZE.h * scale * sil.headSize * 0.78));
  const snoutW = Math.max(0, Math.round(headW * sil.snoutLength * 0.7));
  const snoutH = Math.max(4, Math.round(headH * 0.4));
  const earH = Math.max(4, Math.round(headH * sil.earLength));
  const earW = Math.max(3, Math.round(headW * (sil.earShape === 'drop' ? 0.32 : 0.22)));
  const legH = Math.max(8, Math.round(GRAYBOX_BASE_SIZE.h * scale * sil.legLength * 0.72));
  const legW = Math.max(3, Math.round(Math.max(torsoW * 0.07, 3)));
  return {
    torsoW,
    torsoH,
    legW,
    legH,
    legGap: Math.round(torsoW * 0.22),
    headW,
    headH,
    snoutW,
    snoutH,
    earW,
    earH,
    headForwardPx: Math.round(torsoW * 0.5 - headW * 0.28 + torsoW * (sil.headForward - 0.5) * 0.25),
    tailAttachPx: Math.round(torsoW * (0.48 - sil.tailAttach * 0.12)),
    earShape: sil.earShape,
  };
}

export function resolveGrayboxSize(species: SpeciesData): { w: number; h: number } {
  const g = resolveSilhouette(species);
  return {
    w: Math.max(8, g.torsoW + Math.round(g.headW * 0.55) + g.snoutW),
    h: Math.max(8, g.torsoH + g.legH),
  };
}
