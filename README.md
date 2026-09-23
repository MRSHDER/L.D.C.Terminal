# L.D.C. — LOW-DEFINITION CANINE DATABASE

> 一个以「犬类数据库」为世界观的像素风数字生命档案。
>
> 不是电子宠物，也不是养成游戏 —— 更像一份**拥有生命的数字档案**（Living Specimen）。
> 玩家不是在升级宠物，而是在观察、陪伴、记录不同的犬种。

低分辨率像素风 · GBA / NDS 质感 · 黑白灰为主，天蓝点缀 · 8~12 FPS 的低帧率生命感

---

## 当前状态：Phase 0 / Phase 1（基础框架 + 灰盒验证）

**本阶段不开发任何犬类业务功能。** 目标只有一个：建立可长期维护的框架。

已完成：

| # | 内容 | 状态 |
|---|---|---|
| 1 | Vite + React + TypeScript + PixiJS 工程化 | ✅ |
| 2 | 目录结构（core / species / app / tools / docs） | ✅ |
| 3 | GameLoop（固定步长 + 像素节拍器） | ✅ |
| 4 | EventBus（类型安全事件总线） | ✅ |
| 5 | SpeciesLoader（JSON Schema 校验 + 三层继承） | ✅ |
| 6 | JSON Schema（构建期 ajv 完整校验） | ✅ |
| 7 | StateMachine（层级 FSM + 数据驱动效用裁决） | ✅ |
| 8 | AnimationSystem（灰盒方块呼吸 / 眨眼 / 走动） | ✅ |

**Phase 1 验收标准已达成**：灰盒能根据 JSON 修改移动速度、动画速度与行为节奏，
且改动**不需要修改任何 TypeScript 代码**。

---

## 快速开始

```powershell
npm install
npm run dev          # → http://localhost:5173
```

打开后你会看到一只灰盒方块狗在呼吸、眨眼、走动、坐下、打盹。
右侧面板可以实时调参，观察行为立刻改变。

### 验证「数据驱动」是否真的成立

拖动右侧「参数调校」面板的任意滑块 ——
它直接写入 `species.json` 的对应字段，引擎热应用，无需刷新页面。

或者切换犬种标签（`graybox` ↔ `graybox-swift`），观察两只狗的行为差异。
**两者差异 100% 来自 JSON，`src/core/` 零改动。**

---

## 命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器（支持局域网访问，便于平板 / 触摸屏测试） |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run species:validate` | 校验所有犬种 JSON（提交前必跑） |
| `npm run tune -- <id>` | **迁移标定报告**：每个行为的峰值 / 可达性 / 触发时间 |
| `npm run sim -- <id> <秒数>` | 无头模拟，输出状态分布（无需浏览器） |
| `npm run species:new -- --id X --name Y` | 生成新犬种脚手架 |
| `npm run verify` | 校验 + 构建 |

### 试试无头模拟器

```powershell
npm run sim -- graybox 300
```

它在**不启动浏览器**的情况下跑完整逻辑，输出状态时长分布与切换序列。
这个工具能跑，就证明逻辑层与渲染层是真正解耦的
（它完全不 import PixiJS 与 DOM）。

### 试试标定报告

```powershell
npm run tune -- graybox
```

输出每个行为迁移的峰值、是否可达、以及触发时间。
改行为逻辑前先跑它 —— FSM 的分值是多个因子相乘的结果，人脑推算极易出错。

---

## 项目结构

```
src/
├── core/          引擎核心（新增犬种绝不修改这里）
│   ├── data/      数据契约、默认值、加载与校验
│   ├── event/     事件总线与契约
│   ├── fsm/       层级状态机、迁移表、核心状态
│   ├── animation/ 帧时钟、振荡器、过程动画、动画系统
│   ├── render/    灰盒渲染器、调色板
│   ├── world/     世界编排、向量、随机数
│   └── time/      固定步长循环
│
├── species/       ★ 数据扩展区：只放 JSON
│   ├── index.ts   注册表（唯一需要改的一行）
│   ├── graybox/   灰盒基准体
│   └── graybox-swift/
│
├── app/           React 层（薄壳，不参与每帧渲染）
└── main.tsx

tools/             开发工具（校验 / 模拟 / 标定 / 脚手架）
docs/              架构说明与新增犬种指南
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
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构设计、数据流、状态机算法、踩坑记录 |
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
Phase 0/1  基础框架 + 灰盒验证        ← 当前
Phase 2    数据驱动打通
Phase 3    交互系统（抚摸 / 食物 / 球）
Phase 4    情绪与需求系统
Phase 5    伯恩山真实美术接入
Phase 6    第二只真实犬种            ★ 架构验收关口
Phase 7    档案系统 + Electron / 触摸适配
```

**Phase 6 是整个架构的验收关口**：
如果加边牧需要修改 `src/core/`，说明架构有问题，必须回头改，而不是绕过。

---

## 开发约定

任何新功能都必须**先用灰盒验证，再接入正式美术**。
灰盒能跑通，说明数据流是通的；此时接美术只是替换绘制层。

提交前请确认：

- [ ] `npm run verify` 通过
- [ ] 若新增犬种，`git diff --stat` 中 `src/core/**` 为空

---

## License

MIT
