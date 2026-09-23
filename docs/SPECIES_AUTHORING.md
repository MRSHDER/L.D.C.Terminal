# 新增犬种指南

> 本文档的目标读者：**想往 L.D.C. 里加一只新狗的贡献者**。
> 阅读本文不需要理解引擎内部实现。

---

## 核心承诺

新增一个犬种，**只需要增加 JSON 和资源，不需要修改任何 TypeScript 代码**。

唯一的例外是 `src/species/index.ts` 里加一行注册（见下文）。

如果为了加犬种你不得不改动 `src/core/` 下的任何文件，
说明引擎的抽象出了问题 —— 请提 issue 而不是绕过它。

---

## 快速开始

```powershell
npm run species:new -- --id shiba-inu --name "柴犬"
```

这会生成：

```
src/species/shiba-inu/
├── species.json      ← 身份、性格、认知、动画、偏好
└── behaviors.json    ← 行为权重表

public/assets/species/shiba-inu/
└── README.md         ← 美术资源放置说明
```

然后：

1. 编辑两个 JSON（参考下方"性格 → 表现对照表"）
2. 在 `src/species/index.ts` 注册
3. 验证：`npm run species:validate`
4. 观察：`npm run sim -- shiba-inu 60`

---

## 目录约定

```
src/species/<species-id>/
├── species.json      必需
└── behaviors.json    可选（缺失则继承引擎默认权重）

public/assets/species/<species-id>/
├── atlas.json        美术资源（Phase 5 起使用）
├── atlas.png
└── audio/
```

`<species-id>` 必须是 **小写 kebab-case**（如 `bernese-mountain-dog`），
且必须与 `species.json` 里的 `id` 字段、目录名三者完全一致。

---

## 字段分层：你只需要写"不同"的部分

`species.json` 采用三层继承：

```
DEFAULT_SPECIES（引擎内置中性值）
        ↓ 深合并
你的 species.json（只写与默认不同的字段）
        ↓
最终 SpeciesData（冻结，运行时不可变）
```

**因此你的 JSON 应该很短。** 一个典型犬种约 80~120 行。

### 必需字段（代表"这只狗是谁"）

| 字段 | 说明 |
|---|---|
| `$schema` | 固定 `"ldc/species/v1"` |
| `version` | 语义化版本，如 `"1.0.0"` |
| `id` | 小写 kebab-case，与目录名一致 |
| `displayName` | 至少 `zh` 或 `en` |
| `catalogNo` | `LDC-` + 三位数字，全局唯一 |
| `physical.bodyScale` | 相对基准体型。基准躯干 48×36 像素 |
| `physical.hitbox` | 碰撞体宽高 |
| `personality.temperament` | **九个维度全部必填**，这是犬种的身份 |
| `cognition.decisionIntervalMs` | 思考节奏 |
| `cognition.reactionDelayMs` | 反应延迟区间 |
| `locomotion.walkSpeedPx` | 行走速度 |

### 可选字段（有默认值兜底）

`animation`、`needs`、`preferences`、`resources`、`physical.pettingHotspots`、
`personality.traits`、`cognition.attentionSpanMs` 等。

---

## 性格 → 表现对照表

这是最重要的参考。**先确定你想要什么表现，再去调对应字段。**

### 我想让它……

| 想要的效果 | 调哪个字段 | 参考值 | 极端值 |
|---|---|---|---|
| 反应迟钝 | `cognition.reactionDelayMs` | `[600, 2000]` | `[1000, 3000]` |
| 反应极快 | `cognition.reactionDelayMs` | `[60, 180]` | `[30, 90]` |
| 思考慢、决策少 | `cognition.decisionIntervalMs` | `900` | `1500` |
| 思考快、频繁变主意 | `cognition.decisionIntervalMs` | `180` | `100` |
| 动作慢、有重量感 | `animation.targetFps` + `locomotion.walkSpeedPx` | `8` / `22` | `6` / `16` |
| 动作轻快敏捷 | `animation.targetFps` + `locomotion.walkSpeedPx` | `12` / `62` | `14` / `80` |
| 好动、停不下来 | `temperament.energy` | `0.9` | `0.98` |
| 沉静、爱趴着 | `temperament.energy` | `0.3` | `0.15` |
| 不理人 | `temperament.obedience` + `stubbornness` | `0.3` / `0.8` | `0.1` / `0.95` |
| 一叫就来 | `temperament.obedience` | `0.9` | `0.98` |
| 需要长期培养感情 | `cognition.learningRate` | `0.05` | `0.02` |
| 慢热、怕生 | `temperament.shyness` | `0.8` | `0.95` |
| 黏人 | `temperament.clinginess` | `0.9` | `0.98` |
| 不按套路 | `temperament.randomness` | `0.75` | `0.9` |
| 行为可预测 | `temperament.randomness` | `0.1` | `0.05` |
| 特别爱球 | `preferences.toys.ball` | `0.98` | — |
| 对球没兴趣 | `preferences.toys.ball` | `0.15` | — |
| 走两步就停 | `locomotion.idleWanderRadiusPx` | `25` | — |
| 满屋子跑 | `locomotion.idleWanderRadiusPx` | `140` | — |
| 转身灵活 | `locomotion.turnRateDeg` | `400` | — |
| 转身笨重 | `locomotion.turnRateDeg` | `120` | — |
| 尾巴翘得高 | `animation.tail.baseAngleDeg` | `25` | — |
| 尾巴摆得欢 | `animation.tail.maxSwingDeg` | `35` | — |
| 呼吸快而浅 | `animation.breath.freqHz` | `0.45` | — |
| 呼吸慢而深 | `animation.breath.freqHz` | `0.15` | — |
| 眨眼频繁 | `animation.blink.baseIntervalMs` | `2200` | — |
| 耳朵爱抖 | `animation.ear.triggerBias` | `0.5` | — |

### 九维性格的语义

数值范围 `0..1`，`0.5` 为中性。

| 维度 | 低（0） | 高（1） | 主要影响 |
|---|---|---|---|
| `gentleness` 温柔 | 粗鲁 | 温和 | 被抚摸时的容忍度 |
| `energy` 精力 | 慵懒 | 亢奋 | 走动频率、入睡倾向 |
| `curiosity` 好奇 | 淡漠 | 好奇 | 接近新事物的意愿 |
| `stubbornness` 固执 | 顺从 | 固执 | 被打断时的反应 |
| `shyness` 害羞 | 外向 | 内向 | 接近玩家的速度 |
| `clinginess` 依恋 | 独立 | 黏人 | 跟随倾向 |
| `playfulness` 玩心 | 严肃 | 爱玩 | 玩耍类行为权重 |
| `obedience` 服从 | 不听 | 听话 | 指令响应概率 |
| `randomness` 随机 | 可预测 | 不可预测 | 权重表的打散程度 |

---

## behaviors.json：行为权重

决定「狗倾向于做什么」。可选 —— 不写就继承默认。

```jsonc
{
  "$schema": "ldc/behaviors/v1",
  "id": "shiba-inu",

  // 各状态的基础权重。数值只需**相对**关系正确，绝对值不重要。
  "stateWeights": {
    "Idle": 30,
    "Walk": 20,
    "Sit": 35,    // 柴犬爱坐着
    "Sleep": 15
  },

  // 性格维度 → 状态偏好的敏感度
  // multiplier = 1 + (性格值 - 0.5) × sensitivity × 2
  "personalityBias": {
    "Walk": { "energy": { "sensitivity": 1.7 } },
    "Sit":  { "energy": { "sensitivity": -1.0 } }
  },

  // 交互响应权重（Phase 3 起使用）
  "interactionResponse": {
    "PET": {
      "weights": { "accept": 30, "tolerate": 40, "walkAway": 30 }
    }
  },

  // 低频小动作
  "microBehaviors": [
    { "id": "earTwitch", "chancePerMin": 6 }
  ],

  "extraRandomness": 0.1
}
```

### 敏感度（sensitivity）怎么取

| 值 | 含义 |
|---|---|
| `0` | 该性格维度完全不影响这个状态 |
| `1.0` | 中等影响 |
| `1.7` | 强影响（推荐上限） |
| `-1.0` | 反向：该维度越高，越**不**倾向这个状态 |

超过 `±2.0` 会让状态过度主导，通常不是想要的。

---

## 调参流程（推荐）

**不要凭感觉填数字。** 用工具量化验证：

```powershell
# 1. 数据合法性
npm run species:validate

# 2. 迁移标定报告 —— 检查每个行为是否真的会触发
npm run tune -- shiba-inu

# 3. 无头长时间模拟 —— 看行为分布与节奏
npm run sim -- shiba-inu 300
```

### `npm run tune` 输出怎么读

```
来源      目标            峰值  可达  触发时间   守卫
──────────────────────────────────────────────────
Idle    Sit         49.6   ✓    800ms
Idle    Walk        42.4   ✓   1500ms
Sit     Sleep       38.0   ✓    950ms
Sit     Walk        49.6   ✓   1550ms
```

- **峰值**必须显著高于门槛（当前 `UTILITY_THRESHOLD = 26`）。
  贴着门槛的迁移会随性格波动而消失。
- **触发时间**决定行为先后顺序。同一来源状态的多个目标，
  触发时间必须拉开，否则会有一个垄断全部时间。
- **可达 = ✗** 意味着该行为永远不会发生 —— 必须修。

### `npm run sim` 输出怎么读

```
状态时长分布:
  Walk      86.2%  ███████████████████████████████████████████
  Sit        6.9%  ███
  Idle       4.2%  ██
  Sleep      2.7%  █
```

- 四个核心状态**都应有非零占比**。
- 若某个状态占 95%+，说明存在垄断，需要调整触发时间顺序。
- 占比本身没有"正确答案"，取决于犬种性格 ——
  一只 `energy=0.95` 的狗本就该大部分时间在走动。

---

## 常见错误

| 症状 | 原因 | 解决 |
|---|---|---|
| `species:validate` 报 id 不一致 | JSON 里的 `id` 与目录名不同 | 改成一致 |
| `catalogNo 已被占用` | 编号重复 | 换一个未使用的 `LDC-0XX` |
| 校验报"未知字段" | 拼错了字段名 | 对照 `types.ts` 或 schema |
| 狗完全不动 | `walkSpeedPx` 太小或 `wanderChancePerMin` 为 0 | 调大 |
| 行为闪烁抖动 | `decisionIntervalMs` 太小 | 至少 ≥ 200 |
| 某行为从不出现 | 迁移峰值低于门槛 | 用 `npm run tune` 检查 |
| 所有时间都在走路 | 触发时间顺序失衡 | 用 `npm run tune` 对比触发时间 |

---

## 提交前检查清单

- [ ] `npm run species:validate` 通过，无错误
- [ ] `npm run tune -- <id>` 显示所有行为「可达 ✓」
- [ ] `npm run sim -- <id> 300` 中四个核心状态都出现
- [ ] `git diff --stat` 中 **`src/core/**` 为空**
- [ ] `src/species/index.ts` 只多了一行 import + 一行注册
- [ ] `catalogNo` 未与现有犬种冲突
- [ ] 用 `npm run dev` 目视确认行为符合预期性格

---

## 设计原则（为什么这样设计）

1. **数据与逻辑分离**
   性格不是 `if (species === 'husky')`，而是数据表里的一行数值。
   加犬种不产生新分支，因此不会让代码腐化。

2. **必需 vs 可选的边界**
   凡代表"这只狗是谁"的（性格九维、认知节奏）都是必需；
   凡有合理通用值的（动画细节、偏好）都可继承默认。

3. **灰盒优先**
   任何新能力都先用灰盒（纯色方块）验证管线，再接入美术。
   灰盒能跑通，说明数据流是通的；此时接美术只是替换绘制。

4. **工具量化而非手感调参**
   FSM 的分值是多个因子相乘的结果，人脑推算极易出错。
   `npm run tune` 把「峰值 / 是否可达 / 触发时间」摊开，
   让失衡一眼可见 —— 这个工具的存在本身就说明
   该类系统的调参必须依赖测量。
