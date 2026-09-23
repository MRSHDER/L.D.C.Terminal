# L.D.C. — LOW-DEFINITION CANINE DATABASE

> 一个以「犬类数据库」为世界观的像素风数字生命档案。
>
> 不是电子宠物，也不是养成游戏 —— 更像一份**拥有生命的数字档案**（Living Specimen）。
> 玩家不是在升级宠物，而是在观察、陪伴、记录不同的犬种。

低分辨率像素风 · GBA / NDS 质感 · 黑白灰为主，天蓝点缀 · 8~12 FPS 的低帧率生命感

## 🌐 在线体验

**https://mrshder.github.io/L.D.C.Terminal/**

打开后整个屏幕就是一个房间。**用鼠标按住那只狗** —— 没有按钮，没有菜单。

调试面板在网址后加 `?debug=1` 时出现（默认刻意保持纯净）。

---

## 当前状态：Alpha 打磨

**M1 引擎骨架** 与 **M2 The First Connection** 已完成，
当前处于 Alpha 打磨阶段：**不新增功能**，只优化交互、动画与节奏。

```
第一次摸   →  它看向你
继续摸     →  它慢慢走过来 → 坐到你旁边 → 摇尾巴 → 闭眼享受
快速连点   →  它觉得烦，走开
安静等一会 →  它消气了
冷落很久   →  它慢慢忘了你
```

玩家什么按钮都没点，只是摸。但会觉得「它认识我了」。

### 已完成

| 阶段 | 内容 | 状态 |
|---|---|---|
| **M1** | 引擎骨架（GameLoop / EventBus / SpeciesLoader / FSM / Animation / 灰盒渲染） | ✅ |
| **M2** | 羁绊系统 · 情绪系统 · 手势识别 · 六个互动状态 · 房间 | ✅ |
| **Alpha** | 行为随机性 · 步态动画 · 微行为 · 抚摸语义修正 | ✅ |

**验收**：三个灰盒犬种在**零代码改动**下表现出可测量的性格差异。

| | graybox | graybox-shy | graybox-swift |
|---|---|---|---|
| 摸 5 次后 | 0.78（摇尾巴） | **0.57（仍在犹豫着靠近）** | 0.78 |
| 连点到走开 | 第 10 次 | **第 9 次** | **第 7 次** |
| 静止时占比最高 | Walk 46% | **Sit 59%** | **Walk 64%** |

### 贴近体验的两个细节

**它自己有事做**：不摸它时，它会抖耳朵、甩头、打哈欠、伸懒腰、
叹气 —— 这些动作没有目的、不受玩家影响、时机随机。
恰恰是"没有目的"让它们显得真实。

**每一次抚摸都有回应**：8 次抚摸依次触发
看向你 → 靠近 → 坐下 → 摇尾巴 → 闭眼，羁绊 0.22 逐步涨到 0.96。

---

## 快速开始

```powershell
npm install
npm run dev          # → http://localhost:5173
```

打开后整个屏幕就是那个房间。**用鼠标按住狗**。

调试面板（快照 / 诊断 / 调参）在 `?debug=1` 时出现 ——
默认体验刻意保持纯净，否则第一眼看到的是"一个工具"而不是"一只狗"。

### 验证它真的成立

```powershell
npm run pet -- graybox     # 六个场景的完整互动验证（27 项检查）
npm run calibrate          # 骚扰阈值标定（21 项节奏判定）
```

### 验证数据驱动

拖动 `?debug=1` 面板里的任意滑块 —— 它直接写入 `species.json` 的对应字段，
引擎热应用，无需刷新。或者切换犬种标签，观察完全不同的行为。
**两者差异 100% 来自 JSON，`src/core/` 零改动。**

---

## 命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 体验（加 `?debug=1` 打开调试面板） |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run pet -- <id>` | **互动验证**：六个场景的完整重放 |
| `npm run calibrate` | **骚扰阈值标定**：21 项节奏判定 |
| `npm run species:validate` | 校验所有犬种 JSON（提交前必跑） |
| `npm run tune -- <id>` | **迁移标定报告**：每个行为的峰值 / 可达性 / 触发时间 |
| `npm run sim -- <id> <秒数>` | 无头模拟，输出状态分布（无需浏览器） |
| `npm run species:new -- --id X --name Y` | 生成新犬种脚手架 |
| `npm run verify` | 校验 + 构建 |

### 部署

推送到 `main` 会**自动部署**到 GitHub Pages（见 `.github/workflows/deploy-pages.yml`）。

构建流程包含三道回归闸门，任一失败就不发布：

1. `species:validate` —— 犬种 JSON 非法则直接失败
2. `pet`（三个犬种）—— 互动检查必须全通过
3. `calibrate` —— 骚扰阈值判定必须全通过

> **关于 base path**：GitHub Pages 的项目站点位于 `/<仓库名>/` 子路径下。
> 若 vite 的 `base` 保持默认的 `/`，产物里的资源会指向 `/assets/...`，
> 而实际路径是 `/L.D.C.Terminal/assets/...` —— 整站白屏。
> 因此 workflow 里构建时传 `--base=/L.D.C.Terminal/`。
> 换仓库名时需要同步修改这一处。

### 为什么有这么多"标定"工具

这个项目的核心体验由**多个参数相乘**决定（性格 × 情绪 × 羁绊 × 时间窗口），
人脑推算必然出错。开发中真实发生过：

- Walk 行为整段消失（迁移峰值贴着门槛）
- Sit 占据 62% 时间（迁移触发顺序失衡）
- 温柔地摸被判成骚扰（结算次数被当成了会话次数）
- 狗永远不走开（阈值设成 1.0，而 annoyance 上限也是 1.0）
- 地板渲染成品红（`0x1e1e26` 手算成 `2031654`）

这些从画面上**都看不出是配置错误**。因此每个易错参数都配了扫描/验证工具，
把"感觉不对"变成"数字不对"。

### 试试无头模拟器

```powershell
npm run sim -- graybox 300
```

它在**不启动浏览器**的情况下跑完整逻辑。
这个工具能跑，就证明逻辑层与渲染层是真正解耦的
（它完全不 import PixiJS 与 DOM）。

---

## 项目结构

```
src/
├── core/          引擎核心（新增犬种绝不修改这里）
│   ├── data/      数据契约、默认值、加载与校验
│   ├── event/     事件总线与契约
│   ├── fsm/       层级状态机、迁移表、核心状态、互动状态
│   ├── affection/ ★ M2：羁绊系统、情绪系统
│   ├── interaction/★ M2：指针适配、手势识别、命中检测
│   ├── animation/ 帧时钟、振荡器、过程动画、动画系统
│   ├── render/    灰盒渲染器、房间、调色板
│   ├── world/     世界编排、向量、随机数
│   └── time/      固定步长循环
│
├── species/       ★ 数据扩展区：只放 JSON
│   ├── index.ts   注册表（唯一需要改的一行）
│   ├── graybox/       中性基准体
│   ├── graybox-shy/   慢热害羞型
│   └── graybox-swift/ 敏捷亢奋型
│
├── app/           React 层（薄壳，不参与每帧渲染）
└── main.tsx

tools/             开发工具（校验 / 模拟 / 标定 / 互动验证 / 脚手架）
docs/              架构说明、新增犬种指南、Milestone 记录
```

---

## 设计理念

### 犬种不是换皮

每一种狗都拥有不同的性格、行为、动画节奏、思考速度、喜好与习惯。

**这些全部来自数据，而不是 `if` 判断。**

举例：

| 差异 | 实现字段 |
|---|---|
| 伯恩山动作缓慢、慢热 | `targetFps: 8`、`reactionDelayMs: [400,1200]`、`shyness: 0.55` |
| 边牧反应极快、爱球 | `decisionIntervalMs: 180`、`preferences.toys.ball: 0.98` |
| 哈士奇不按套路 | `randomness: 0.85`、`obedience: 0.25` |
| 柴犬高冷、需要建立信任 | `shyness: 0.80`、`learningRate: 0.05` |

同一份代码，参数不同 → 四种截然不同的生命。

### 素材最小化

呼吸、眨眼、耳朵抖动、尾巴摆动、上下浮动**全部由代码生成**，不占素材。
只需绘制行走 / 坐下 / 吃饭 / 睡觉等关键帧。

一只犬种的美术量可控在 40 帧以内。

### 低帧率是意图，不是妥协

8~12 FPS 是**设计选择**。每个犬种的帧率也不同 —— 帧率本身就是性格语言。

---

## 新增一个犬种

```powershell
npm run species:new -- --id shiba-inu --name "柴犬" --name-en "Shiba Inu" --catalog "LDC-004"
```

然后编辑生成的 JSON、在 `src/species/index.ts` 注册一行、跑 `npm run species:validate`。

**不需要写任何 TypeScript。**

完整指南（含「性格 → 表现」对照表与调参流程）见
[docs/SPECIES_AUTHORING.md](docs/SPECIES_AUTHORING.md)。

---

## 文档

| 文档 | 内容 |
|---|---|
| [docs/ALPHA_POLISH.md](docs/ALPHA_POLISH.md) | **Alpha 打磨记录**：五轮修复、踩坑、验收数据 |
| [docs/MILESTONE_2.md](docs/MILESTONE_2.md) | The First Connection：羁绊/情绪机制、标定数据 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构设计、数据流、状态机算法、渲染陷阱 |
| [docs/SPECIES_AUTHORING.md](docs/SPECIES_AUTHORING.md) | 新增犬种指南、字段对照表、调参流程 |

---

## 技术栈

- **React 18** + **TypeScript 5.7** + **Vite 6** — 应用外壳与工程化
- **PixiJS 8** — 分层精灵渲染（过程动画需要独立图层变换）
- **ajv** — 构建期 JSON Schema 校验

目标平台：浏览器 / Windows / 触摸显示器 / 平板；未来可封装 Electron。

---

## 路线图

```
M1  引擎骨架 + 灰盒验证              ✅ 已完成
M2  The First Connection            ✅ 已完成
      一个房间 · 摸它 · 羁绊 + 情绪
Alpha 打磨                           ✅ 已完成
      行为随机性 · 步态动画 · 微行为 · 抚摸语义
M3  拖拽：🍖 ⚽ 🥣 三个东西           ← 下一步
     拖到嘴边 → 吃 / 拖到地上 → 闻 → 决定 / 拖到碗 → 走过去吃
M4  Personality：真正体现犬种差异
     拖球 → 边牧疯狂玩 / 伯恩山玩一会就回来
M5  真实美术：灰盒全部替换
     Idle / Walk / Sit / Eat / Sleep
M6  第二只狗：边牧                   ★ 架构验收关口
     若完全不用改 core/ → 架构成功
```

### 明确不做的事

按项目要求，以下都**不在**当前阶段：

❌ Memory · ❌ AI · ❌ 成长 · ❌ 数据库存档 · ❌ 多房间 · ❌ 多狗

以后都有时间。

**Phase M6 是整个架构的验收关口**：
如果加边牧需要修改 `src/core/`，说明架构有问题，必须回头改，而不是绕过。

---

## 开发约定

任何新功能都必须**先用灰盒验证，再接入正式美术**。
灰盒能跑通，说明数据流是通的；此时接美术只是替换绘制层。

提交前请确认：

- [ ] `npm run verify` 通过
- [ ] `npm run calibrate` 全部判定正确
- [ ] `npm run pet -- <id>` 无失败项
- [ ] 若新增犬种，`git diff --stat` 中 `src/core/**` 为空

---

## License

MIT
