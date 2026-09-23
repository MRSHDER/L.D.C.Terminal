/**
 * L.D.C. — 深合并（Deep Merge）
 *
 * 用于实现「默认值 → 模板 → 犬种」的三层继承。
 *
 * 规则：
 *  - 普通对象：递归合并
 *  - 数组：整体替换（不是拼接）—— 因为列表语义上代表"完整覆盖"
 *  - undefined：跳过（保留基底值）
 *  - null：显式清空（允许犬种主动抹掉默认值）
 *  - 其余原始值：覆盖
 */

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined) return base;
  if (override === null) return null as unknown as T;
  if (Array.isArray(override)) return override as unknown as T;

  if (isPlainObject(base) && isPlainObject(override)) {
    const out: PlainObject = { ...base };
    for (const [key, value] of Object.entries(override)) {
      if (value === undefined) continue;
      out[key] = key in out ? deepMerge(out[key], value) : value;
    }
    return out as unknown as T;
  }

  return override as unknown as T;
}

/** 递归冻结，保证运行时数据不可变（防止某个状态意外改到配置） */
export function deepFreeze<T>(value: T): Readonly<T> {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;

  Object.freeze(value);
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as PlainObject)[key]);
  }
  return value;
}

/**
 * 收集两个对象之间的差异路径。
 * 用于「调试面板显示这只狗改了哪些默认值」，也让贡献者一眼看出犬种特征。
 */
export function diffPaths(base: unknown, override: unknown, prefix = ''): string[] {
  if (override === undefined) return [];
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return [prefix || '(root)'];
  }
  const out: string[] = [];
  for (const [key, value] of Object.entries(override)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.push(...diffPaths((base as PlainObject)[key], value, path));
  }
  return out;
}
