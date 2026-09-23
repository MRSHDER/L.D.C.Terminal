/**
 * L.D.C. — 诊断面板（DiagnosticsPanel）
 *
 * 两个用途：
 *   ① 展示校验告警 —— 让写错 JSON 的贡献者立刻看到问题在哪
 *   ② 展示状态打分表 —— 回答「它为什么选择了这个行为」
 *
 * 第 ② 点对长期维护至关重要：行为不再是黑箱。
 */

import type { EngineSnapshot } from '../hooks/useEngine';

interface DiagnosticsPanelProps {
  readonly snapshot: EngineSnapshot;
}

export function DiagnosticsPanel({ snapshot }: DiagnosticsPanelProps): React.JSX.Element {
  const { warnings, stateScores } = snapshot;

  // 按分数降序展示，并归一化为条形宽度
  const entries = Object.entries(stateScores).sort((a, b) => b[1] - a[1]);
  const max = entries.length > 0 ? Math.max(...entries.map(([, v]) => v)) : 1;

  return (
    <section className="ldc-panel">
      <h2 className="ldc-panel__title">
        行为打分 <span className="ldc-panel__badge">why this behavior</span>
      </h2>

      {entries.length === 0 ? (
        <p className="ldc-panel__desc">等待首次决策…</p>
      ) : (
        <ul className="ldc-scores">
          {entries.map(([id, score]) => (
            <li key={id} className={id === snapshot.currentState ? 'ldc-score ldc-score--active' : 'ldc-score'}>
              <span className="ldc-score__name">{id}</span>
              <span className="ldc-score__bar">
                <i style={{ width: `${max > 0 ? Math.max(2, (score / max) * 100) : 0}%` }} />
              </span>
              <span className="ldc-score__val ldc-mono">{score.toFixed(1)}</span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="ldc-group">校验告警</h3>
      {warnings.length === 0 ? (
        <p className="ldc-ok">✓ 数据合法，无告警</p>
      ) : (
        <ul className="ldc-warnings">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
