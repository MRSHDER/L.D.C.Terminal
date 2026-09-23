/**
 * L.D.C. — 参数调校面板（TuningPanel）
 *
 * ★ 本面板是 Phase 0/1 的验收工具：
 *   面板上每一个滑块都直接对应 species.json 里的一个字段。
 *   拖动滑块 → 写入 JSON 路径 → 引擎热应用 → 行为/动画立即改变。
 *
 *   如果任何一项需要修改代码才能生效，说明架构还没达标。
 */

import type { EngineSnapshot } from '../hooks/useEngine';

interface TuningPanelProps {
  readonly snapshot: EngineSnapshot;
  readonly onPatch: (patch: Record<string, unknown>) => void;
}

interface SliderRowProps {
  readonly label: string;
  readonly path: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: string;
  readonly hint?: string;
  readonly onChange: (value: number) => void;
}

function SliderRow(props: SliderRowProps): React.JSX.Element {
  return (
    <label className="ldc-slider">
      <span className="ldc-slider__head">
        <span className="ldc-slider__label">{props.label}</span>
        <span className="ldc-slider__value">
          {Number.isInteger(props.step) ? props.value : props.value.toFixed(2)}
          {props.unit ?? ''}
        </span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number.parseFloat(e.target.value))}
      />
      <span className="ldc-slider__path">
        <code>{props.path}</code>
        {props.hint && <em>{props.hint}</em>}
      </span>
    </label>
  );
}

export function TuningPanel({ snapshot, onPatch }: TuningPanelProps): React.JSX.Element {
  const s = snapshot;

  return (
    <section className="ldc-panel">
      <h2 className="ldc-panel__title">
        参数调校 <span className="ldc-panel__badge">写入 species.json</span>
      </h2>
      <p className="ldc-panel__desc">
        拖动下方任意滑块，即等价于修改该犬种 JSON 中的对应字段。引擎会热应用，无需刷新页面、无需改代码。
      </p>

      <h3 className="ldc-group">移动速度</h3>
      <SliderRow
        label="行走速度"
        path="locomotion.walkSpeedPx"
        value={s.walkSpeedPx}
        min={4}
        max={140}
        step={1}
        unit=" px/s"
        hint="越大走得越快"
        onChange={(v) => onPatch({ locomotion: { walkSpeedPx: v } })}
      />

      <h3 className="ldc-group">动画节奏</h3>
      <SliderRow
        label="像素帧率"
        path="animation.targetFps"
        value={s.targetFps}
        min={2}
        max={24}
        step={1}
        unit=" fps"
        hint="低帧率 = 生命感，不是性能妥协"
        onChange={(v) => onPatch({ animation: { targetFps: v } })}
      />

      <h3 className="ldc-group">行为节奏</h3>
      <SliderRow
        label="决策间隔"
        path="cognition.decisionIntervalMs"
        value={s.decisionIntervalMs}
        min={60}
        max={2000}
        step={20}
        unit=" ms"
        hint="越大思考越慢"
        onChange={(v) => onPatch({ cognition: { decisionIntervalMs: v } })}
      />
      <SliderRow
        label="反应延迟（下限）"
        path="cognition.reactionDelayMs[0]"
        value={s.reactionDelayMs[0]}
        min={0}
        max={1500}
        step={20}
        unit=" ms"
        hint="感知到刺激后『愣一下』的时间"
        onChange={(v) => onPatch({ cognition: { reactionDelayMs: [v, Math.max(v, s.reactionDelayMs[1])] } })}
      />

      <h3 className="ldc-group">体型</h3>
      <SliderRow
        label="体型缩放"
        path="physical.bodyScale"
        value={s.bodyScale}
        min={0.4}
        max={2.4}
        step={0.02}
        unit="×"
        hint="同时影响灰盒尺寸与命中框"
        onChange={(v) => onPatch({ physical: { bodyScale: v } })}
      />
      <SliderRow
        label="躯干长度"
        path="physical.silhouette.bodyLength"
        value={s.silhouette.bodyLength}
        min={0.8}
        max={1.8}
        step={0.02}
        hint="越大越扁长，越不像箱子"
        onChange={(v) => onPatch({ physical: { silhouette: { bodyLength: v } } })}
      />
      <SliderRow
        label="头探出"
        path="physical.silhouette.headForward"
        value={s.silhouette.headForward}
        min={0.1}
        max={1}
        step={0.02}
        hint="侧视关键：头在身体前方而不是正上方"
        onChange={(v) => onPatch({ physical: { silhouette: { headForward: v } } })}
      />
      <SliderRow
        label="吻长"
        path="physical.silhouette.snoutLength"
        value={s.silhouette.snoutLength}
        min={0}
        max={1}
        step={0.02}
        hint="0 = 没吻"
        onChange={(v) => onPatch({ physical: { silhouette: { snoutLength: v } } })}
      />
      <SliderRow
        label="腿长"
        path="physical.silhouette.legLength"
        value={s.silhouette.legLength}
        min={0.2}
        max={0.8}
        step={0.02}
        onChange={(v) => onPatch({ physical: { silhouette: { legLength: v } } })}
      />
      <SliderRow
        label="耳长"
        path="physical.silhouette.earLength"
        value={s.silhouette.earLength}
        min={0.2}
        max={0.9}
        step={0.02}
        onChange={(v) => onPatch({ physical: { silhouette: { earLength: v } } })}
      />

      <p className="ldc-panel__foot">
        <code>↺ 还原 JSON</code> 可丢弃全部改动，回到磁盘上的原始数据。
      </p>
    </section>
  );
}
