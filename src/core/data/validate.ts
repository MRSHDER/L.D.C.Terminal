/**
 * L.D.C. — 结构校验（轻量，零依赖）
 *
 * 为什么不用 ajv 在运行时：
 *   浏览器打包体积敏感，而 JSON Schema 校验在「构建期 + 编辑期」更有价值。
 *   因此：
 *     - 运行时：本文件的手写校验（覆盖所有必填项、数值范围、枚举），体积极小
 *     - 构建期：tools/validate-species.ts 使用完整 ajv + JSON Schema，给出精确错误路径
 *
 * 两层校验的字段集合必须保持一致 —— 修改 types.ts 时两处都要更新。
 */

export type ValidationErrors = string[];

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const inUnit = (v: unknown): boolean => isNumber(v) && v >= 0 && v <= 1;

function requireObject(
  parent: Record<string, unknown>,
  key: string,
  path: string,
  errors: ValidationErrors,
): Record<string, unknown> | undefined {
  const value = parent[key];
  if (value === undefined) {
    errors.push(`缺少必需字段: ${path}.${key}`);
    return undefined;
  }
  if (!isObject(value)) {
    errors.push(`${path}.${key} 必须是对象，实际是 ${Array.isArray(value) ? 'array' : typeof value}`);
    return undefined;
  }
  return value;
}

function requireNumber(
  parent: Record<string, unknown>,
  key: string,
  path: string,
  errors: ValidationErrors,
  opts: { min?: number; max?: number; integer?: boolean } = {},
): void {
  const value = parent[key];
  if (value === undefined) {
    errors.push(`缺少必需字段: ${path}.${key}`);
    return;
  }
  if (!isNumber(value)) {
    errors.push(`${path}.${key} 必须是数字，实际是 ${typeof value}`);
    return;
  }
  if (opts.integer && !Number.isInteger(value)) {
    errors.push(`${path}.${key} 必须是整数，实际是 ${value}`);
  }
  if (opts.min !== undefined && value < opts.min) {
    errors.push(`${path}.${key} = ${value}，不能小于 ${opts.min}`);
  }
  if (opts.max !== undefined && value > opts.max) {
    errors.push(`${path}.${key} = ${value}，不能大于 ${opts.max}`);
  }
}

function requireUnit(
  parent: Record<string, unknown>,
  key: string,
  path: string,
  errors: ValidationErrors,
): void {
  const value = parent[key];
  if (value === undefined) {
    errors.push(`缺少必需字段: ${path}.${key}`);
    return;
  }
  if (!inUnit(value)) {
    errors.push(`${path}.${key} 必须是 0..1 的数，实际是 ${JSON.stringify(value)}`);
  }
}

/** 校验 species.json 的原始（未合并）数据 */
export function validateSpeciesShape(raw: Record<string, unknown>): ValidationErrors {
  const errors: ValidationErrors = [];

  // ── 顶层标量 ──
  if (!isString(raw['version']) || !/^\d+\.\d+\.\d+$/.test(raw['version'])) {
    errors.push('version 必须是语义化版本字符串，如 "1.0.0"');
  }
  if (!isString(raw['id']) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(raw['id'])) {
    errors.push('id 必须是小写 kebab-case（如 "bernese-mountain-dog"）');
  }
  if (!isString(raw['catalogNo']) || !/^LDC-\d{3}$/.test(raw['catalogNo'])) {
    errors.push('catalogNo 必须是 "LDC-" + 三位数字，如 "LDC-001"');
  }

  // ── displayName ──
  const dn = requireObject(raw, 'displayName', '', errors);
  if (dn) {
    if (!isString(dn['zh']) && !isString(dn['en'])) {
      errors.push('displayName 至少需要 zh 或 en 之一');
    }
  }

  // ── physical ──
  const physical = requireObject(raw, 'physical', '', errors);
  let hitbox: Record<string, unknown> | undefined;
  if (physical) {
    requireNumber(physical, 'bodyScale', 'physical', errors, { min: 0.01, max: 5 });
    hitbox = requireObject(physical, 'hitbox', 'physical', errors);
  }
  if (hitbox) {
    requireNumber(hitbox, 'w', 'physical.hitbox', errors, { min: 1 });
    requireNumber(hitbox, 'h', 'physical.hitbox', errors, { min: 1 });
  }

  // ── personality.temperament（全部必填，这是犬种的身份） ──
  const personality = requireObject(raw, 'personality', '', errors);
  let temperament: Record<string, unknown> | undefined;
  if (personality) {
    temperament = requireObject(personality, 'temperament', 'personality', errors);
  }
  if (temperament) {
    const KEYS = [
      'gentleness',
      'energy',
      'curiosity',
      'stubbornness',
      'shyness',
      'clinginess',
      'playfulness',
      'obedience',
      'randomness',
    ] as const;
    for (const k of KEYS) requireUnit(temperament, k, 'personality.temperament', errors);
  }

  // ── cognition ──
  const cognition = requireObject(raw, 'cognition', '', errors);
  if (cognition) {
    requireNumber(cognition, 'decisionIntervalMs', 'cognition', errors, { min: 16, integer: true });
    const range = cognition['reactionDelayMs'];
    if (!Array.isArray(range) || range.length !== 2 || !isNumber(range[0]) || !isNumber(range[1])) {
      errors.push('cognition.reactionDelayMs 必须是 [min, max] 两个数字组成的数组');
    }
  }

  // ── locomotion ──
  const locomotion = requireObject(raw, 'locomotion', '', errors);
  if (locomotion) {
    requireNumber(locomotion, 'walkSpeedPx', 'locomotion', errors, { min: 0 });
  }

  // ── animation（可选，但写了就要合法） ──
  if (raw['animation'] !== undefined) {
    const animation = requireObject(raw, 'animation', '', errors);
    if (animation) {
      requireNumber(animation, 'targetFps', 'animation', errors, { min: 1, max: 60 });
      if (animation['breath'] !== undefined) {
        const b = requireObject(animation, 'breath', 'animation', errors);
        if (b) {
          requireNumber(b, 'freqHz', 'animation.breath', errors, { min: 0 });
          requireNumber(b, 'ampPx', 'animation.breath', errors, { min: 0 });
          requireNumber(b, 'bodyScaleY', 'animation.breath', errors, { min: 0 });
        }
      }
      if (animation['blink'] !== undefined) {
        const b = requireObject(animation, 'blink', 'animation', errors);
        if (b) {
          requireNumber(b, 'baseIntervalMs', 'animation.blink', errors, { min: 100 });
          requireNumber(b, 'varianceMs', 'animation.blink', errors, { min: 0 });
          requireNumber(b, 'durationMs', 'animation.blink', errors, { min: 16 });
        }
      }
      if (animation['tail'] !== undefined) {
        const t = requireObject(animation, 'tail', 'animation', errors);
        if (t) {
          requireNumber(t, 'segments', 'animation.tail', errors, { min: 1, max: 8, integer: true });
          requireNumber(t, 'maxSwingDeg', 'animation.tail', errors, { min: 0 });
        }
      }
    }
  }

  // ── preferences（可选，写了就要合法） ──
  if (raw['preferences'] !== undefined) {
    const prefs = requireObject(raw, 'preferences', '', errors);
    if (prefs) {
      for (const key of ['toys', 'places', 'touch'] as const) {
        const map = prefs[key];
        if (map === undefined) continue;
        if (!isObject(map)) {
          errors.push(`preferences.${key} 必须是对象`);
          continue;
        }
        for (const [k, v] of Object.entries(map)) {
          if (!inUnit(v)) errors.push(`preferences.${key}.${k} 必须是 0..1 的数，实际是 ${JSON.stringify(v)}`);
        }
      }
    }
  }

  // ── needs（可选） ──
  if (raw['needs'] !== undefined) {
    const needs = requireObject(raw, 'needs', '', errors);
    if (needs) {
      for (const key of ['hunger', 'energy', 'social'] as const) {
        const cfg = needs[key];
        if (cfg === undefined) continue;
        if (!isObject(cfg)) {
          errors.push(`needs.${key} 必须是对象`);
          continue;
        }
        requireNumber(cfg, 'decayPerMin', `needs.${key}`, errors, { min: 0 });
        requireUnit(cfg, 'criticalAt', `needs.${key}`, errors);
      }
    }
  }

  return errors;
}

/** 校验 behaviors.json 的原始数据 */
export function validateBehaviorsShape(raw: Record<string, unknown>): ValidationErrors {
  const errors: ValidationErrors = [];

  const stateWeights = raw['stateWeights'];
  if (stateWeights !== undefined) {
    if (!isObject(stateWeights)) {
      errors.push('stateWeights 必须是对象');
    } else {
      for (const [k, v] of Object.entries(stateWeights)) {
        if (!isNumber(v) || v < 0) {
          errors.push(`stateWeights.${k} 必须是非负数字，实际是 ${JSON.stringify(v)}`);
        }
      }
    }
  }

  const bias = raw['personalityBias'];
  if (bias !== undefined) {
    if (!isObject(bias)) {
      errors.push('personalityBias 必须是对象');
    } else {
      for (const [stateId, entry] of Object.entries(bias)) {
        if (!isObject(entry)) {
          errors.push(`personalityBias.${stateId} 必须是对象`);
          continue;
        }
        for (const [dim, cfg] of Object.entries(entry)) {
          if (!isObject(cfg)) {
            errors.push(`personalityBias.${stateId}.${dim} 必须是对象`);
            continue;
          }
          const s = cfg['sensitivity'];
          if (!isNumber(s) || s < -4 || s > 4) {
            errors.push(
              `personalityBias.${stateId}.${dim}.sensitivity 必须是 -4..4 的数，实际是 ${JSON.stringify(s)}`,
            );
          }
        }
      }
    }
  }

  const responses = raw['interactionResponse'];
  if (responses !== undefined) {
    if (!isObject(responses)) {
      errors.push('interactionResponse 必须是对象');
    } else {
      for (const [intent, cfg] of Object.entries(responses)) {
        if (!isObject(cfg)) {
          errors.push(`interactionResponse.${intent} 必须是对象`);
          continue;
        }
        const weights = cfg['weights'];
        if (!isObject(weights) || Object.keys(weights).length === 0) {
          errors.push(`interactionResponse.${intent}.weights 必须是非空对象`);
        } else {
          for (const [k, v] of Object.entries(weights)) {
            if (!isNumber(v) || v < 0) {
              errors.push(`interactionResponse.${intent}.weights.${k} 必须是非负数字`);
            }
          }
        }
        const conditions = cfg['conditions'];
        if (conditions !== undefined) {
          if (!Array.isArray(conditions)) {
            errors.push(`interactionResponse.${intent}.conditions 必须是数组`);
          } else {
            conditions.forEach((c, i) => {
              if (!isObject(c) || !isString(c['when']) || c['when'].length === 0) {
                errors.push(`interactionResponse.${intent}.conditions[${i}] 必须含非空字符串 when`);
              }
            });
          }
        }
      }
    }
  }

  const micros = raw['microBehaviors'];
  if (micros !== undefined) {
    if (!Array.isArray(micros)) {
      errors.push('microBehaviors 必须是数组');
    } else {
      micros.forEach((m, i) => {
        if (!isObject(m)) {
          errors.push(`microBehaviors[${i}] 必须是对象`);
          return;
        }
        if (!isString(m['id'])) errors.push(`microBehaviors[${i}].id 必须是字符串`);
        if (!isNumber(m['chancePerMin']) || m['chancePerMin'] < 0) {
          errors.push(`microBehaviors[${i}].chancePerMin 必须是非负数字`);
        }
      });
    }
  }

  return errors;
}
