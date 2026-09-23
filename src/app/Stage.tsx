/**
 * L.D.C. — 灰盒舞台（Stage）
 *
 * 这是 Phase 0/1 的验证界面。它的唯一目的：
 *   让「改 JSON → 立即看到行为/动画变化」这件事变得肉眼可见。
 *
 * ★ 界面上所有可调项都直接写进 species JSON 的路径，
 *   没有任何一项是硬编码在代码里的常量。
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
 *   改动下面的数字却忘了改 CSS 时，会立刻在控制台报错，
 *   而不是产出一个"看起来有点变形"的画面（那种 bug 极难发现）。
 */
if (import.meta.env.DEV) {
  const PADDING_TOP_PERCENT = 62.5;
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

  return (
    <div className="ldc-root">
      <header className="ldc-header">
        <div className="ldc-brand">
          <span className="ldc-brand__mark">L.D.C.</span>
          <span className="ldc-brand__sub">LOW-DEFINITION CANINE DATABASE</span>
        </div>
        <div className="ldc-header__phase">
          <span className="ldc-badge">PHASE 0 / 1</span>
          <span className="ldc-header__note">灰盒验证 · 非电子宠物功能</span>
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
              灰盒状态：<code>{snapshot.currentState}</code>
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
        <span>
          覆盖默认值 <b>{snapshot.overriddenCount}</b> 项
        </span>
      </footer>
    </div>
  );
}
