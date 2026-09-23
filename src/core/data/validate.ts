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

/**
 * 已知微行为 id。
 *
 * ★ 这里刻意**重复声明**而不是 import MicroBehaviorSystem 的常量。
 *
 *   原因：依赖方向。data/ 是底层（数据契约与校验），
 *   behavior/ 是上层（行为实现）。让 data/ 依赖 behavior/
 *   会形成反向依赖，破坏分层。
 *
 *   代价是两处清单可能漂移。为此 tools/validate-species.ts
 *   在构建期会交叉比对两者，不一致时直接报错 ——
 *   用工具保证一致性，而不是靠人记得同步。
 */
export const KNOWN_MICRO_BEHAVIORS_IDS: readonly string[] = [
  'earTwitch',
  'headShake',
  'yawn',
  'stretch',
  'sigh',
  'blink',
];

const KNOWN_MICRO_BEHAVIORS = new Set<string>(KNOWN_MICRO_BEHAVIORS_IDS);

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

function validateOptionalSpriteMetrics(
  obj: Record<string, unknown>,
  path: string,
  errors: ValidationErrors,
): void {
  if (obj['frameWidth'] !== undefined) {
    requireNumber(obj, 'frameWidth', path, errors, { min: 1, integer: true });
  }
  if (obj['frameHeight'] !== undefined) {
    requireNumber(obj, 'frameHeight', path, errors, { min: 1, integer: true });
  }
  if (obj['baselineY'] !== undefined && !isNumber(obj['baselineY'])) {
    errors.push(`${path}.baselineY 必须是数字`);
  }
  if (obj['anchor'] !== undefined) {
    const anchor = obj['anchor'];
    if (!Array.isArray(anchor) || anchor.length !== 2 || !isNumber(anchor[0]) || !isNumber(anchor[1])) {
      errors.push(`${path}.anchor 必须是长度为 2 的 number 数组`);
    }
  }
}

function validateSpriteClip(raw: unknown, path: string, errors: ValidationErrors): void {
  if (!isObject(raw)) {
    errors.push(`${path} 必须是对象`);
    return;
  }
  if (!isString(raw['src']) || raw['src'].length === 0) {
    errors.push(`${path}.src 必须是非空字符串`);
  }
  requireNumber(raw, 'frames', path, errors, { min: 1, integer: true });
  if (raw['fps'] === undefined) {
    errors.push(`缺少必需字段: ${path}.fps`);
  } else if (!isNumber(raw['fps']) || raw['fps'] <= 0) {
    errors.push(`${path}.fps 必须是大于 0 的数字，实际是 ${JSON.stringify(raw['fps'])}`);
  }
  validateOptionalSpriteMetrics(raw, path, errors);
}
