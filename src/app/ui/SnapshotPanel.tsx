/**
 * L.D.C. — 状态快照面板（SnapshotPanel）
 *
 * 展示引擎当前的真实内部状态。这是判断「架构是否达标」的主要窗口：
 *   - 切换犬种 → 所有数值来自 JSON，代码零改动
 *   - 观察 stateScores → 能回答「它为什么走了」这个问题
 */

import type { EngineSnapshot } from '../hooks/useEngine';

interface SnapshotPanelProps {
  readonly snapshot: EngineSnapshot;
  readonly onSwitchSpecies: (id: string) => void;
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }): React.JSX.Element {
  return (
    <div className="ldc-row">
      <span className="ldc-row__k">{label}</span>
      <span className={mono ? 'ldc-row__v ldc-mono' : 'ldc-row__v'}>{value}</span>
    </div>
  );
}

export function SnapshotPanel({ snapshot, onSwitchSpecies }: SnapshotPanelProps): React.JSX.Element {
  const s = snapshot;

  return (
    <section className="ldc-panel">
      <h2 className="ldc-panel__title">
        引擎快照 <span className="ldc-panel__badge">只读</span>
      </h2>

      <div className="ldc-species-switch">
        {s.speciesIds.map((id) => (
          <button
            key={id}
            className={id === s.speciesId ? 'ldc-tab ldc-tab--active' : 'ldc-tab'}
            onClick={() => onSwitchSpecies(id)}
          >
            {id}
          </button>
        ))}
      </div>

      <Row label="档案编号" value={s.catalogNo} mono />
      <Row label="显示名称" value={s.displayName} />
      <Row label="当前状态" value={<code className="ldc-state">{s.currentState}</code>} />
      <Row label="世界坐标" value={`${s.position.x}, ${s.position.y}`} mono />
      <Row label="当前速度" value={`${s.speed} px/s`} mono />
      <Row label="已运行" value={`${(s.elapsedMs / 1000).toFixed(1)} s`} mono />

      {s.degraded && (
        <div className="ldc-alert ldc-alert--error">
          数据加载失败，已降级为默认值。请查看下方诊断信息。
        </div>
      )}
    </section>
  );
}
