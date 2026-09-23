/**
 * L.D.C. — Stage（Milestone 2：The First Connection）
 *
 * ★★★ 本阶段的界面只有：一个房间，一只狗。★★★
 *
 * 项目要求原文：
 *   "没有 UI。没有菜单。没有按钮。"
 *   玩家唯一能做的事就是「摸它」。
 *
 * 因此本文件**刻意不渲染任何调试面板**。
 * 开发期的调参/快照/诊断面板依然存在，但只在 `?debug=1` 时出现 ——
 * 默认体验必须纯净，否则玩家第一眼看到的是"一个工具"，
 * 而不是"一只在房间里的狗"。
 *
 * 这本身就是设计决定的一部分：
 *   如果开发时天天面对满屏面板，就很难做出"它是一只狗"的体验。
 *   把面板藏起来，逼迫自己只通过画面判断成败。
 */

import { useEngine } from './hooks/useEngine';
import { TuningPanel } from './ui/TuningPanel';
import { SnapshotPanel } from './ui/SnapshotPanel';
import { DiagnosticsPanel } from './ui/DiagnosticsPanel';
import './Stage.css';

/** 设计分辨率：低分辨率像素风的基础画布尺寸 */
const DESIGN_W = 320;
const DESIGN_H = 200;

/**
 * ★ 设计分辨率的宽高比必须与 Stage.css 中 `.ldc-stage__frame` 的
 *   `padding-top` 一致，否则画布会被裁切或拉伸。
 *   CSS 无法读取 TS 常量，因此在此做运行时断言 ——
 *   改动下面的数字却忘了改 CSS 时，会立刻在控制台报错。
 */
const PADDING_TOP_PERCENT = 62.5;
if (import.meta.env.DEV) {
  const actual = (DESIGN_H / DESIGN_W) * 100;
  if (Math.abs(actual - PADDING_TOP_PERCENT) > 0.01) {
    console.error(
      `[LDC] Stage.css 的 padding-top (${PADDING_TOP_PERCENT}%) 与设计分辨率 ` +
        `${DESIGN_W}×${DESIGN_H} 的宽高比 (${actual.toFixed(2)}%) 不一致。请同步修改。`,
    );
  }
}

export function Stage(): React.JSX.Element {
  const engine = useEngine(DESIGN_W, DESIGN_H);
  const { snapshot } = engine;

  // 调试面板仅在 ?debug=1 时出现。
  // 默认体验 = 一个房间 + 一只狗，没有任何界面元素。
  const debugVisible =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debug') === '1';

  return (
    <div className={debugVisible ? 'ldc-root ldc-root--debug' : 'ldc-root ldc-root--room'}>
      {!debugVisible && (
        <div className="ldc-room">
          <div className="ldc-room__frame">
            <div ref={engine.containerRef} className="ldc-room__canvas" />
            {snapshot.error && (
              <div className="ldc-room__error">
                <strong>渲染器初始化失败</strong>
                <pre>{snapshot.error}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      {debugVisible && (
        <>
          <header className="ldc-header">
            <div className="ldc-brand">
              <span className="ldc-brand__mark">L.D.C.</span>
              <span className="ldc-brand__sub">LOW-DEFINITION CANINE DATABASE</span>
            </div>
            <div className="ldc-header__phase">
              <span className="ldc-badge">M2 · THE FIRST CONNECTION</span>
              <span className="ldc-header__note">调试模式（?debug=1）</span>
            </div>
          </header>

          <main className="ldc-main">
            <section className="ldc-stage">
              <div className="ldc-stage__frame">
                <div ref={engine.containerRef} className="ldc-stage__canvas" />
                {snapshot.error && (
                  <div className="ldc-stage__error">
                    <strong>渲染器初始化失败</strong>
                    <pre>{snapshot.error}</pre>
                  </div>
                )}
                {!snapshot.ready && !snapshot.error && (
                  <div className="ldc-stage__loading">引擎启动中…</div>
                )}
              </div>

              <div className="ldc-stage__bar">
                <button className="ldc-btn" onClick={engine.isPaused ? engine.resume : engine.pause}>
                  {engine.isPaused ? '▶ 继续' : '⏸ 暂停'}
                </button>
                <button className="ldc-btn" onClick={engine.resetSpecies}>
                  ↺ 还原 JSON
                </button>
                <span className="ldc-stage__hint">
                  状态：<code>{snapshot.currentState}</code>
                </span>
              </div>
            </section>

            <aside className="ldc-side">
              <SnapshotPanel snapshot={snapshot} onSwitchSpecies={engine.switchSpecies} />
              <DiagnosticsPanel snapshot={snapshot} />
              <TuningPanel snapshot={snapshot} onPatch={engine.patchSpecies} />
            </aside>
          </main>

          <footer className="ldc-footer">
            <span>
              逻辑帧 <b>{snapshot.tick}</b>
            </span>
            <span>
              渲染 <b>{snapshot.fps.toFixed(0)}</b> fps
            </span>
            <span>
              像素帧 <b>{snapshot.targetFps}</b> fps
            </span>
          </footer>
        </>
      )}
    </div>
  );
}
