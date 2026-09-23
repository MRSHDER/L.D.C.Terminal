# L.D.C. 架构说明

**LOW-DEFINITION CANINE DATABASE** — 以犬类数据库为世界观的像素风数字生命档案。

---

## 当前阶段

**Milestone 2：The First Connection**

| 阶段 | 内容 | 状态 |
|---|---|---|
| M1 | 引擎骨架：GameLoop / EventBus / SpeciesLoader / FSM / Animation / 灰盒渲染 | ✅ |
| M2 | 羁绊系统 · 情绪系统 · 手势识别 · 六个互动状态 · 房间 | ✅ |

**尚未开始**：食物 / 球 / 碗（M3）、犬种人格差异（M4）、真实美术（M5）、第二只狗（M6）。

> M2 的详细机制、标定数据与踩坑记录见 **[MILESTONE_2.md](MILESTONE_2.md)**。

---

## 设计约束（宪法级）

后续所有决策都由这三条推导。改动它们需要充分的架构理由。

### 1. 狗是数据 + 解释器，不是类

`species.json` 是纯数据，`Behaviors` 是通用行为原语。
新犬种 = 新 JSON + 新资源目录，**永不触碰 `src/core/`**。

### 2. 渲染是状态的纯函数

状态机不知道 Canvas 存在，渲染层不知道狗为什么坐下。
中间只有一条单向数据流：`World → RenderState → Renderer`。

### 3. 生命感来自噪声与节奏，不来自帧数

8~12 FPS 是**意图**，不是性能妥协。
呼吸 / 眨眼 / 耳朵 / 尾巴由代码在低帧率节拍上叠加，不占素材。

### 4. （M2 新增）情绪驱动表现，而非状态驱动动画

状态只需修改情绪（如 `WagTail` 拉高 arousal），
动画层从「情绪修饰表」读取参数自动跟随 ——
因此"被摸时尾巴摆得更欢"不需要为每个状态写动画。

---

## 目录结构

```
src/
├── core/                     ★ 引擎核心：新增犬种绝不修改
│   ├── data/                 数据契约与加载
│   │   ├── types.ts          所有数据结构的单一真相源
│   │   ├── defaults.ts       DEFAULT_SPECIES / DEFAULT_BEHAVIORS
│   │   ├── merge.ts          深合并 / 深冻结 / 差异比对
│   │   ├── validate.ts       运行时轻量校验（含语义陷阱检查）
│   │   ├── SpeciesLoader.ts  加载 → 合并 → 校验 → 冻结
│   │   ├── SpeciesRegistry.ts 犬种注册表
│   │   └── schema/           JSON Schema（构建期 ajv 校验用）
│   ├── event/                事件总线
│   ├── fsm/                  层级状态机
│   │   ├── StateMachine.ts   通用 HFSM + 效用裁决
│   │   ├── transitions.ts    通用迁移表 + 准入守卫
│   │   ├── interactionTransitions.ts  ★ M2 羁绊阶梯裁决
│   │   └── states/
│   │       ├── coreStates.ts         Idle / Walk / Sit / Sleep
│   │       └── interactionStates.ts  ★ M2 六个互动姿态
│   ├── affection/            ★ M2 情感层
│   │   ├── BondSystem.ts     羁绊阶梯（"它认识我吗"）
│   │   └── MoodSystem.ts     情绪四量 + 骚扰时间窗口
│   ├── interaction/          ★ M2 输入层
│   │   ├── PointerAdapter.ts     鼠标/触摸/笔 归一化
│   │   ├── GestureRecognizer.ts  点击/长按/连点识别
│   │   └── InteractionSystem.ts  命中检测 + 抚摸会话
│   ├── animation/            动画系统
│   ├── render/               渲染（唯一接触 Pixi 的地方）
│   ├── world/                世界与工具
│   │   ├── World.ts          子系统编排 + 唯一逻辑入口
│   │   └── blackboardAccess.ts ★ M2 系统引用交换区
│   └── time/
│       └── GameLoop.ts       固定步长循环
│
├── species/                  ★ 数据扩展区：只放 JSON
│   ├── index.ts              注册表（唯一需要改的一行）
│   ├── graybox/              中性基准体
│   ├── graybox-shy/          慢热害羞型
│   └── graybox-swift/        敏捷亢奋型
│
├── app/                      React 层（薄）
└── main.tsx

tools/
├── validate-species.ts       构建期 JSON Schema 校验
├── simulate.ts               无头模拟器
├── tune-transitions.ts       ★ 迁移标定报告
├── pet-test.ts               ★ M2 互动验证（六场景）
├── calibrate-annoyance.ts    ★ M2 骚扰阈值标定
└── new-species.ts            犬种脚手架生成

docs/
├── ARCHITECTURE.md           本文档
├── SPECIES_AUTHORING.md      新增犬种指南
└── MILESTONE_2.md            ★ M2 机制与标定记录
```

---

## 数据流

```
species.json ──┐
behaviors.json ┤
               ↓
      SpeciesLoader（合并 → 校验 → 冻结）
               ↓
      SpeciesRegistry ──→ World ←── EventBus
                            │
              ┌─────────────┼─────────────┐
              ↓             ↓             ↓
        StateMachine  AnimationSystem  （Phase 4 情绪）
              │             │
              └──────┬──────┘
                     ↓
              RenderState（不可变快照）
                     ↓
              GrayboxRenderer → Pixi → Canvas
```

**关键约束**：`World` 是唯一逻辑入口。
`GameLoop.update()` 驱动 `World.update()`，`GameLoop.render()` 读 `World.getRenderState()`。
渲染层**绝不会**修改逻辑数据。

### 解耦的证明：无头模拟器

`tools/simulate.ts` 只 import `core/` 下的逻辑，**完全不接触 Pixi 与 DOM**。

```powershell
npm run sim -- graybox 300   # 无需浏览器即可观察行为
```

这个工具能跑，就说明逻辑层与渲染层是真正解耦的。
它是 Phase 0 最重要的验收标准之一。

---

## 状态机设计

### 为什么是层级（HFSM）而非扁平

扁平 FSM 在 4 犬种 × 12 状态时组合爆炸。
层级让「共性」住父状态、「个性」住参数。

### 状态是通用的，性格是数据

`Idle` / `Walk` / `Sit` / `Sleep` 是**通用行为**，不是犬种专属。
犬种差异全部来自 JSON：

| 差异来源 | JSON 字段 |
|---|---|
| 走多快 | `locomotion.walkSpeedPx` |
| 动画节奏 | `animation.targetFps` |
| 思考与反应速度 | `cognition.decisionIntervalMs` / `reactionDelayMs` |
| 想做什么 | `behaviors.stateWeights` / `personalityBias` |
| 体型 | `physical.bodyScale` |

### 效用裁决算法

```
候选分数 = 归一化状态偏好 × (1 + 迁移效用 / 30)
切换条件 = 最高候选分 > UTILITY_THRESHOLD(26)
```

**归一化状态偏好**：

```
偏好 = (stateWeights[状态] / 总和) × ∏(1 + (性格值 - 0.5) × 敏感度 × 2)
```

性格值 0.5 为中性（乘子 = 1）。
因此同一份迁移表，在 `energy=0.35` 的伯恩山上产生"不爱动"，
在 `energy=0.95` 的边牧上产生"停不下来"。

### ★ 三层防护（这是最容易出错的地方）

FMS 的调参踩过很多坑，最终形成三层结构。**理解这三层是修改行为逻辑的前提。**

| 层 | 名称 | 作用 | 位置 |
|---|---|---|---|
| 1 | `Transition.guard` | 拦一条具体的边 | `transitions.ts` |
| 2 | **准入守卫** | 拦"进入某状态"这件事本身，无论路径 | `admissionGuards` |
| 3 | **效用门槛** | 拦"意愿不足"的切换 | `StateMachine.ts` |

#### 为什么需要第 2 层（准入守卫）

状态基础偏好（`stateWeights`）会让状态**绕过所有迁移守卫**成为候选。

实例：给 `Walk → Idle` 加了 guard 后，狗仍走了 0.5 秒就被拉回 Idle ——
因为 Idle 从「基础偏好通道」直接进来了，guard 形同虚设。

因此必须有准入守卫：**只有通过准入的状态才能作为切换目标**，
无论它来自迁移表还是基础偏好。

#### 为什么需要第 3 层（效用门槛）

门槛经历了四版才稳定。完整记录（**请勿重复这些尝试**）：

| 方案 | 门槛 | 结果 |
|---|---|---|
| A | `stay × 0.35` | 任何微扰都切走，Idle 只活 0.5 秒 |
| B | `stay × 1.6` | 超过竞争者天花板，永远不动 |
| C | 绝对门槛 0.30 | Idle 偏好 0.43 本身即达标 → 从任何状态立刻切回 Idle |
| D | `stay × 1.25` | 又超过天花板，永远不动 |
| ✅ | **只比较效用 > 26** | 稳定，各状态均衡出现 |

**根因**：竞争者分数与"维持现状"分数处在**不同尺度**（效用 vs 份额）。
只要门槛与份额同尺度，高偏好状态就会在两个极端间摆动 —— 无解。
**正确解法是把门槛建在效用尺度上，份额只负责"选谁"，不参与"够不够格"。**

---

## 动画系统

### 三层模型

```
Layer 3: Procedural   代码生成：呼吸 / 眨眼 / 耳 / 尾 / 浮动    ← 不占素材
Layer 2: Transition   状态切换过渡                              ← Phase 5
Layer 1: Keyframe     美术绘制的关键帧                          ← Phase 5
```

### 素材最小化

**只需绘制 6 组关键动画**，其余全部程序化：

| 需求 | 实现 | 素材量 |
|---|---|---|
| 呼吸 | 纵向缩放正弦 + 像素对齐 | 0 |
| 上下浮动 | 低频噪声位移 | 0 |
| 尾巴摆动 | 分段延迟旋转（鞭状跟随） | 0 |
| 耳朵抖动 | 触发式脉冲振荡 | 0 |
| 眨眼 | 泊松式随机间隔 + 开合包络 | 0 |
| 行走 / 坐下 / 吃饭 / 睡觉 / 叫 | 关键帧 | 约 26 帧 |

### 低帧率节拍（FrameClock）

逻辑以固定步长（1/60 s）运行，像素帧率由 `animation.targetFps` 量化。
保证在 144 Hz 与 30 Hz 设备上动画速度一致。

**每个犬种的 targetFps 也不同** —— 伯恩山 8、边牧 12。
**帧率本身就是性格语言。**

### 情绪耦合（为 Phase 4 预留）

`ProceduralContext` 已经接收 `arousal`（兴奋度）与 `alertness`（清醒度）：
- `arousal` 高 → 呼吸快而浅、尾巴摆幅大、眨眼频繁
- `alertness` 低 → 呼吸慢而深、眨眼变多

Phase 4 接入情绪系统后，这些值将由 `MoodVector` 提供，
**无需修改动画层代码**。

---

## 事件系统

```ts
bus.on('state:decision', ({ chosen, scores }) => {
  // scores 是完整打分表 —— 回答"它为什么这样动"
});
```

设计原则：**Event 只描述"已经发生了什么"，绝不携带"接下来该做什么"。**
所有决策仍在 StateMachine 内完成，防止逻辑散落。

事件契约集中在 `core/event/events.ts`，新增事件只需加一行。

---

## 渲染

### 分层精灵

```
shadow  地面阴影，不随呼吸移动
body    躯干，承载呼吸形变
tail    尾巴分段（3~4 段，鞭状跟随）
earL/R  耳朵，承载抖动
head    头部，承载 headDown
eyes    眼睛，承载眨眼
```

分层是过程动画的前提 —— 没有独立图层，就无法让尾巴单独摆动。

### 像素风要点

- `image-rendering: pixelated` + CSS 双保险
- 所有绘制坐标 `Math.round()`，避免亚像素模糊
- 渲染分辨率固定为 1（不随 devicePixelRatio 提升）
- 用「切角」而非抗锯齿圆角

### ★ 渲染器生命周期（两个真实陷阱）

在 React StrictMode 下，effect 会「挂载 → 卸载 → 再挂载」。
这暴露了两个必须处理的竞态：

**陷阱 1：清理路径不能早退**

```ts
// ✗ 错误：init 未完成时 initialized 为 false，画布从未被移除
destroy() { if (!this.initialized) return; ... }

// ✓ 正确：无条件清理
destroy() { /* ... 用 try/catch 容忍未初始化状态 ... */ }
```

若清理早退，第二次挂载会 append 第二个 canvas。
两个画布叠在一起，上面那个属于已废弃渲染器且永不重绘 → **画面全黑**。

此时场景图、RenderState、渲染调用次数**全部正常**，极具迷惑性。
（实际排查中，渲染调用 241 次/秒，画面却全黑。）

**陷阱 2：init 完成后必须再检查一次 disposed**

```ts
await renderer.init(host);
if (disposed) { renderer.destroy(); return; }  // ← 必须有
```

因为首次挂载的 effect 在 `await` 期间已被清理，
但 `init()` 仍会跑完并 appendChild。

**兜底防线**：`init()` 最先记录 `hostElement`，
`destroy()` 最后扫描容器内所有 canvas 并移除，不依赖 Pixi 内部状态。

---

## 数据系统

### 校验双层

| 层 | 工具 | 时机 | 目的 |
|---|---|---|---|
| 轻量 | `data/validate.ts` | 运行时 | 体积小，覆盖必填与范围 |
| 完整 | ajv + JSON Schema | `npm run species:validate` | 精确错误路径，CI 拦截 |

贡献者提 PR 加犬种时，JSON 写错必须**在 CI 直接失败**，
而不是运行时白屏。这是"几乎不用修改核心代码"的安全网。

### 降级策略

加载失败**不崩溃**，回退到 `DEFAULT_SPECIES` 并发出 `species:failed`。
让写错 JSON 的贡献者不会导致白屏，而是看到明确错误。

---

## 工具链

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器（支持局域网访问，便于平板/触摸屏测试） |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run species:validate` | 校验所有犬种 JSON |
| `npm run species:new -- --id X --name Y` | 生成新犬种脚手架 |
| `npm run sim -- <id> <秒数>` | 无头模拟，输出状态分布与切换序列 |
| `npm run tune -- <id>` | ★ 迁移标定报告：峰值 / 可达 / 触发时间 |
| `npm run verify` | 校验 + 构建（提交前跑） |

### 为什么需要 `tune` 工具

FSM 的分值是「基础峰值 × patience 窗口 × 性格乘子 × 节奏因子」相乘的结果，
与门槛比较。人脑推算这些乘积极易出错。

实际开发中反复出现两类失衡：
- 某迁移峰值贴着门槛 → 该行为**完全消失**（Walk 曾整段不见）
- 某迁移峰值远超门槛且窗口短 → 它**垄断全部时间**（Sit 曾占 62%）

`tune` 把「峰值 / 是否可达 / 触发时间」摊开成表，
让失衡一眼可见。**改行为逻辑前先跑它。**

---

## 扩展性验证

两个灰盒犬种构成一组对照实验：

| | graybox | graybox-swift |
|---|---|---|
| `energy` | 0.5 | 0.95 |
| `targetFps` | 10 | 12 |
| `walkSpeedPx` | 30 | 62 |
| `decisionIntervalMs` | 500 | 180 |
| `bodyScale` | 1.0 | 0.78 |
| 实测行为 | 走 / 坐 / 站 / 睡 交替 | 几乎全程走动 |

**两者差异 100% 来自 JSON，`src/core/` 零改动。**

这就是 Phase 6（加入第二只真实犬种）的验收标准：
若加边牧需要动 `src/core`，说明架构有问题，必须回头改，而不是绕过。

---

## 后续阶段

```
M1  引擎骨架 + 灰盒验证              ✅ 已完成
M2  The First Connection            ✅ 已完成
M3  拖拽：🍖 ⚽ 🥣                    ← 下一步
M4  Personality：真正体现犬种差异
M5  真实美术接入
M6  第二只真实犬种                   ★ 架构验收关口
M7  档案系统 + Electron / 触摸适配
```

**M6 是整个架构的验收关口**：
如果加边牧需要修改 `src/core/`，说明架构有问题，必须回头改，而不是绕过。

### M2 为 M3 铺好的路

- `PointerAdapter` 已支持多指（`primaryOnly: false` 即可接拖拽）
- `GestureRecognizer` 已能识别 `stroke`（拖拽轨迹）
- `InteractionSystem` 的命中检测可直接复用于"食物落在哪"
- 情绪修饰表已能驱动"吃东西时的兴奋表现"
