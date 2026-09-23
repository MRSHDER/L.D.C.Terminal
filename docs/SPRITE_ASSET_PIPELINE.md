# Sprite Asset Pipeline

本文档说明 L.D.C. Terminal 从灰盒犬到正式像素犬素材的接入规范。目标是让第一只正式犬种资源可以稳定接入，同时保持项目的核心承诺：新增犬种主要增加数据与资源，不修改 `src/core/`。

## 目标

当前项目已经有 M1 引擎骨架和 M2 互动生命感。正式像素素材接入时，先不要追求一次性完成所有犬种，而是先把一只犬的资源路径、命名、帧率、动画键名和切图方式定稳。

第一只建议使用 Bernese Mountain Dog，原因是它动作慢、体型大、性格稳，比较适合验证低帧率生命感。

## 资源目录

每只犬种的正式素材放在：

```text
public/assets/species/<species-id>/sprites/
```

例如：

```text
public/assets/species/bernese-mountain-dog/sprites/
```

建议第一阶段先使用独立 PNG 帧列或横向 sprite sheet，之后再考虑 texture atlas。不要在早期直接把所有素材塞进一个大 atlas，避免切错、替换困难。

## 命名规范

动作文件统一使用英文小写与 kebab-case。建议如下：

```text
idle.png
walk.png
run.png
sit.png
sniff.png
tail-wag.png
eat.png
drink.png
sleep.png
pet-enjoy.png
```

如果一个动作拆成多个方向，方向放在动作名前：

```text
side-idle.png
side-walk.png
side-run.png
front-sit.png
side-eat.png
side-drink.png
```

如果一个动作使用单帧序列而不是整张 sprite sheet：

```text
side-walk-00.png
side-walk-01.png
side-walk-02.png
side-walk-03.png
```

同一个动作不要混用两种命名方式。

## 第一阶段动作清单

第一阶段只接入下面 8 组动作。它们足够覆盖现在的互动闭环，也不会把美术量拉爆。

| 动作键名 | 中文说明 | 建议帧数 | 建议帧率 | 说明 |
|---|---|---:|---:|---|
| `idle` | 待机 / 呼吸 | 4-6 | 6-8 fps | 轻微胸腔起伏，头部和尾巴尽量少动 |
| `walk` | 走路 | 4-6 | 8-10 fps | 低速、有重量感，脚步不要太跳 |
| `run` | 跑步 | 4-6 | 10-12 fps | 只用于短距离冲向食物或玩具 |
| `sit` | 坐下 | 4-6 | 6-8 fps | 可以是过渡帧，也可以接一个坐姿循环 |
| `sniff` | 低头 / 嗅闻 | 4-6 | 6-8 fps | 食物在地上、碗边、陌生物靠近时使用 |
| `tail-wag` | 摇尾 | 4-6 | 8-12 fps | 只做尾巴和轻微身体摆动，不必全身大动 |
| `eat` | 吃东西 | 4-6 | 6-8 fps | 嘴和头部靠近碗，身体尽量稳定 |
| `drink` | 喝水 | 4-6 | 6-8 fps | 与 eat 共用大体姿势，但碗和舌头不同 |

后续再增加：

```text
sleep
wake
look-at
approach
leave
pet-enjoy
annoyed
stretch
yawn
ear-flick
```

这些属于第二阶段。第一阶段不要为了它们重构系统。

## 画布与切图规则

每一帧必须使用同一个画布尺寸。同一犬种不要让每帧裁切尺寸随姿势变化。

建议 Bernese Mountain Dog 第一版使用：

```text
单帧逻辑尺寸：96 × 64 px
朝向：侧视，面向右
导出缩放：1x
背景：透明
描边：深色硬边描边
抗锯齿：关闭
```

如果素材生成工具无法稳定产出透明底，可以先用深色纯色背景导出，再单独抠成透明 PNG。接入代码前必须清理背景。

所有帧都要对齐同一基线：

```text
脚掌落地点一致
头部允许变化
尾巴允许超出主体，但不能超出画布
碗、水盆等道具不要烙死进狗的基础动作，除非该动作明确是 eat 或 drink
```

## Sprite Sheet 规则

如果使用横向 sprite sheet：

```text
frameWidth = 96
frameHeight = 64
margin = 0
spacing = 0
order = left-to-right
```

例如 6 帧 walk：

```text
side-walk.png = 576 × 64 px
```

如果使用 2 行或多行动作图，必须配套一个同名 JSON 描述切片。第一阶段不推荐多行动作图。

## 数据配置建议

正式接入时，不要把资源路径写死到渲染组件里。应放进犬种数据或资源配置中。

建议在 `species.json` 的 `resources` 字段中维护动作资源映射，例如：

```json
{
  "resources": {
    "sprites": {
      "basePath": "/assets/species/bernese-mountain-dog/sprites/",
      "animations": {
        "idle": {
          "src": "side-idle.png",
          "frameWidth": 96,
          "frameHeight": 64,
          "frames": 6,
          "fps": 8,
          "loop": true
        },
        "walk": {
          "src": "side-walk.png",
          "frameWidth": 96,
          "frameHeight": 64,
          "frames": 6,
          "fps": 10,
          "loop": true
        }
      }
    }
  }
}
```

如果当前 schema 还不支持该结构，先不要直接改 core。可以先在文档和资源目录中约定，等 M5 资源接入阶段再扩展 schema。

## 行为到动作的映射

渲染层只关心当前表现动作，不关心动作为什么发生。建议映射如下：

| 行为 / 状态 | 动作键名 |
|---|---|
| Idle | `idle` |
| Walk | `walk` |
| Approach | `walk` 或 `run` |
| Sit | `sit` |
| Sleep | `sleep` |
| LookAt | `idle` + 头部朝向修饰 |
| WagTail | `tail-wag` |
| PetEnjoy | `pet-enjoy` 或 `tail-wag` |
| Food near ground | `sniff` |
| Feed by bowl | `eat` |
| Drink | `drink` |

动作选择可以由 RenderState 层完成，不要让素材系统反向影响 World 或 FSM。

## PixiJS 接入建议

第一版实现建议保持简单：

1. 预加载当前犬种的动作图片。
2. 按 `frameWidth` 和 `frameHeight` 从横向 sprite sheet 切帧。
3. 使用 PixiJS `AnimatedSprite` 或项目内已有动画系统播放。
4. 动作切换时保留当前角色位置、朝向、缩放和阴影。
5. 只允许渲染层读取资源配置，不允许渲染层修改犬种数据。

动作切换时注意：

```text
idle → walk：立即切换
walk → idle：脚落地后切换更自然，但第一版可立即切换
any → eat/drink：允许 100-200ms 短暂停顿
pet-enjoy → idle：不要瞬间恢复，保留 300ms 余韵
```

## 生成素材验收标准

素材进入仓库前必须检查：

- 每帧尺寸一致。
- 朝向一致。
- 基线一致。
- 背景透明。
- 关闭抗锯齿。
- 颜色数量可控，不要出现照片式渐变。
- 狗的白胸、黑背、棕色眉点和棕腿在每帧保持稳定。
- 尾巴、耳朵、鼻子、脚掌不要在帧间随机变形。
- 帧与帧之间的体型不能突然变大或变小。

如果使用 AI 批量生成，要先人工筛掉体型漂移严重的帧，不要直接接入。

## 接入顺序

建议按下面顺序进入代码：

1. 只接 `idle`，确认透明底、缩放、位置和阴影正确。
2. 接 `walk`，确认原来的移动逻辑不变。
3. 接 `sit`，确认状态切换不破坏位置。
4. 接 `tail-wag`，确认抚摸反馈明显。
5. 接 `sniff`、`eat`、`drink`，配合 M3 交互意图使用。
6. 最后再补 `run` 和其他微行为。

不要一次性把 8 组动作全接上，否则很难判断问题来自资源、切图、渲染，还是状态机。

## 当前不做的事

第一版不做：

- 多方向八向行走。
- 骨骼动画。
- 自动从整张大图识别帧。
- 复杂 atlas packer。
- 在 `src/core/` 为 Bernese Mountain Dog 写特殊判断。
- 为单个犬种创建专属 renderer。

## 推荐给生成工具的提示词要点

生成动作素材时，提示词必须固定下面这些条件：

```text
Bernese Mountain Dog, side view facing right, consistent sprite sheet, pixel art, 96x64 frame, no anti-aliasing, transparent background, dark outline, limited palette, same body proportions in every frame, same ground baseline, GBA/NDS era pixel style, low frame animation, no background scene
```

动作只改姿态，不改角色设计。每次生成一组动作，不要把所有动作混在一张大海报里。

## 与项目架构的关系

这份规范延续现有设计：

- 犬种身份来自 `species.json`。
- 行为差异来自数据。
- 渲染是状态的纯函数。
- 素材系统只负责表现，不反向决定行为。
- 新增犬种主要新增 JSON 和资源目录。

如果未来接入真实素材时发现必须修改 `src/core/`，先写设计说明，再改 schema 或资源解释器。不要为了赶进度把某只狗写死进核心逻辑。
