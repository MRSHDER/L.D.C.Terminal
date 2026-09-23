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

  // ── affection（Milestone 2，可选） ──
  if (raw['affection'] !== undefined) {
    const aff = requireObject(raw, 'affection', '', errors);
    if (aff) {
      if (aff['bonding'] !== undefined) {
        const b = requireObject(aff, 'bonding', 'affection', errors);
        if (b) {
          requireNumber(b, 'gainPerPet', 'affection.bonding', errors, { min: 0, max: 1 });
          requireNumber(b, 'decayPerSec', 'affection.bonding', errors, { min: 0 });
          const ladder = b['ladder'];
          if (ladder !== undefined) {
            if (!Array.isArray(ladder) || ladder.length === 0) {
              errors.push('affection.bonding.ladder 必须是非空数组');
            } else {
              ladder.forEach((r, i) => {
                if (!isObject(r)) {
                  errors.push(`affection.bonding.ladder[${i}] 必须是对象`);
                  return;
                }
                requireUnit(r, 'atBond', `affection.bonding.ladder[${i}]`, errors);
                if (!isString(r['state']) || r['state'].length === 0) {
                  errors.push(`affection.bonding.ladder[${i}].state 必须是非空字符串`);
                }
              });

              // ★ 阶梯阈值必须严格递增 —— 否则某一级永远不会被选中。
              //   这类错误不会崩溃，只会让"狗永远停在低级别"，
              //   极难从画面上判断，因此必须在构建期拦住。
              const thresholds = ladder
                .filter(isObject)
                .map((r) => r['atBond'])
                .filter(isNumber);
              for (let i = 1; i < thresholds.length; i++) {
                if (thresholds[i]! <= thresholds[i - 1]!) {
                  errors.push(
                    `affection.bonding.ladder 阈值必须严格递增，但 [${i}] = ${thresholds[i]} ≤ [${i - 1}] = ${thresholds[i - 1]}`,
                  );
                }
              }
            }
          }
        }
      }

      if (aff['petting'] !== undefined) {
        const p = requireObject(aff, 'petting', 'affection', errors);
        if (p) {
          requireNumber(p, 'minEffectiveMs', 'affection.petting', errors, { min: 16 });
          requireUnit(p, 'pleasureBase', 'affection.petting', errors);
          requireUnit(p, 'arousalGain', 'affection.petting', errors);
        }
      }

      if (aff['annoyance'] !== undefined) {
        const a = requireObject(aff, 'annoyance', 'affection', errors);
        if (a) {
          requireNumber(a, 'windowMs', 'affection.annoyance', errors, { min: 100 });
          requireNumber(a, 'threshold', 'affection.annoyance', errors, { min: 1, integer: true });
          requireNumber(a, 'annoyancePerExcess', 'affection.annoyance', errors, { min: 0 });
          requireNumber(a, 'decayPerSec', 'affection.annoyance', errors, { min: 0 });
          requireNumber(a, 'leaveAt', 'affection.annoyance', errors, { min: 0.01 });
          requireNumber(a, 'sulkMs', 'affection.annoyance', errors, { min: 0 });

          // ★ leaveAt 必须可达。
          //
          //   annoyance 经 clamp01 限制在 [0, 1]。
          //   若 leaveAt 接近或超过 1，狗**永远不会走开** —— 因为达不到阈值。
          //
          //   这个 bug 在开发中真实发生过两次（graybox 与 graybox-shy），
          //   表现都是"连点它不生气"，从画面上完全看不出是配置错误。
          //   更隐蔽的是：性格修正会乘一个系数（可能 > 1），
          //   因此即便 leaveAt < 1，乘完之后仍可能越过 1。
          //
          //   这里保守要求 leaveAt ≤ 0.85，为性格修正留出余量。
          const leaveAt = a['leaveAt'];
          if (isNumber(leaveAt) && leaveAt > 0.85) {
            errors.push(
              `affection.annoyance.leaveAt = ${leaveAt} 过高（应 ≤ 0.85）。` +
                `annoyance 上限为 1.0，而性格修正会乘一个可能 > 1 的系数，` +
                `leaveAt 过大会导致「烦躁永远达不到阈值、狗永远不走开」。`,
            );
          }
        }
      }
    }
  }

  // ── room（Milestone 2，可选） ──
  if (raw['room'] !== undefined) {
    const room = requireObject(raw, 'room', '', errors);
    if (room) {
      requireNumber(room, 'floorLineRatio', 'room', errors, { min: 0, max: 1 });
      requireNumber(room, 'floorColor', 'room', errors, { min: 0 });
      requireNumber(room, 'wallColor', 'room', errors, { min: 0 });

      // ★ 颜色必须落在「黑白灰」基调内。
      //
      //   项目视觉约束是"黑白灰为主，少量天蓝强调"。
      //   房间配色手写成十进制很容易出错 —— 开发中真实发生过一次：
      //   把 0x1e1e26 手算成 2031654（实际应为 1973798），
      //   结果地板渲染成刺眼的品红，而 JSON 本身完全合法、校验通过。
      //
      //   这里检查 RGB 三通道的**色度差**：通道间差异过大意味着高饱和度，
      //   与项目的低饱和像素风冲突。注意这是"告警"级设计约束，
      //   因此仅对明显偏色（差值 > 48）报错。
      for (const key of ['floorColor', 'floorShadeColor', 'wallColor'] as const) {
        const c = room[key];
        if (!isNumber(c)) continue;
        const r = (c >> 16) & 0xff;
        const g = (c >> 8) & 0xff;
        const b = c & 0xff;
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        if (spread > 48) {
          errors.push(
            `room.${key} = ${c} (#${c.toString(16).padStart(6, '0')}) 饱和度偏高（通道差 ${spread}）。` +
              `项目配色为黑白灰基调，请确认是否把十六进制手算错了` +
              `（例如应为 0x1e1e26 = 1973798）。`,
          );
        }
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
