/// <reference types="vite/client" />

/**
 * L.D.C. — Vite 环境类型
 * 允许 import JSON 模块并获得类型推断。
 */
declare module '*.json' {
  const value: unknown;
  export default value;
}
