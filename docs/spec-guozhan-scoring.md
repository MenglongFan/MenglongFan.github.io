# 规格文档 · 三国杀国战积分系统

> **⚠️ 已归档（2026-09-21）· 本文档描述的前端已下线**
>
> 本文档描述的是**旧的单文件原生版** `scoring.html`（三国水墨风格）。
> 该文件已于 2026-09-21 从仓库移除，**线上地址 `menglongfan.github.io/scoring.html` 不再存在**。
>
> 当前线上前端是 **React 版**，部署在 `menglongfan.github.io/scoring/`：
>
> | | |
> | --- | --- |
> | 源码 | `react-app/`（React 18 + Vite 5 + react-router-dom HashRouter）|
> | 构建产物 | `scoring/`（提交进仓库，GitHub Pages 直接提供）|
> | 首页入口 | `index.html` 项目卡 2，`data-href="./scoring/"` |
> | 部署步骤 | 见 `worker/README.md` |
>
> **后端部分（Cloudflare D1 + Workers、积分公式、罚金规则）完全没有变**，
> 本文档中与后端、数据模型、评分规则、用户故事相关的内容依然有效，
> 可直接作为 React 版的需求依据。
> 本文正文保留原样，作为旧版前端的实现记录，不再逐处改写。

## Problem Statement

线下打三国杀国战时，缺乏一个便捷的积分追踪工具。每次聚会打好几局，积分靠脑子记或纸笔写，聚会结束就丢失了。需要一个所有参与者都能通过手机访问的 Web 应用，实时查看赛季排名，并在房主授权下录入每局成绩。

## Solution

一个部署在 GitHub Pages 的三国水墨风格单页应用 `scoring.html`，配合 Cloudflare D1 + Workers 作为免费后端。所有访问者可查看当前赛季排名榜；房主通过共享密码授权后可录入成绩、管理花名册和赛季。数据存储在 Cloudflare D1（真正的 SQLite），所有设备访问同一份数据。

## User Stories

### 排名查看

1. 作为任意访客，我打开 `scoring.html` 就能看到当前赛季的排名榜，这样我能立刻知道谁是赛季领跑者。
2. 作为任意访客，排名榜按总积分从高到低排列，这样我一眼就能看到第一名在顶部。
3. 作为任意访客，排名榜显示每个玩家的名字、总积分和参与对局数，这样我能了解每个人的参赛情况。
4. 作为任意访客，如果当前没有活跃赛季，我看到"暂无活跃赛季"提示，而不是空白页面。
5. 作为任意访客，如果赛季还没有任何对局记录，我看到"赛季尚未开始，等待第一局录入"提示。
6. 作为任意访客，我点击排名榜中某个玩家，能展开他本赛季的逐局得分明细，这样积分有争议时可回溯。
7. 作为任意访客，再次点击已展开的玩家明细，能收起回到纯排名视图。
8. 作为任意访客，排名榜页面在手机浏览器上全屏显示，不需要横向滚动。
9. 作为任意访客，页面使用三国水墨风格（竹简/卷轴/墨色），和作品集其他项目的东方美学风格一致。

### 成绩录入

10. 作为房主，我点击页面上的浮动按钮打开"录入成绩"弹窗，系统要求我输入房主密码。
11. 作为房主，我输入正确密码后，弹窗显示花名册中所有已注册玩家，我勾选今天到场的 5-10 人。
12. 作为房主，如果我勾选少于 5 人，提交按钮禁用并提示"至少需要 5 人"。
13. 作为房主，如果我勾选超过 10 人，提交按钮禁用并提示"最多 10 人"。
14. 作为房主，选人确认后进入淘汰顺序排列界面，所有选中的玩家按默认顺序排列。
15. 作为房主，我能通过拖拽重新排列玩家顺序，排在最上面的是最后存活者，排在最下面的是第一个被淘汰者。
16. 作为房主，我能标记排在顶部的 1-N 个玩家为"存活者"（冠军段），存活者数量等于总人数减去死亡人数。
17. 作为房主，系统在我排列和标记存活者的过程中，实时显示每个玩家将获得的分数预览。
18. 作为房主，分数预览按积分公式自动计算：存活者各得 (死亡人数+1) 分，死者按淘汰顺序从死亡人数递减至 1。
19. 作为房主，确认分数预览无误后，点击"提交"按钮保存这局成绩到数据库。
20. 作为房主，提交成功后弹窗关闭，排名榜自动刷新显示新的积分。
21. 作为房主，如果我输入的房主密码错误，系统拒绝打开录入界面并提示"密码错误"。
22. 作为房主，录入完成后我能在排名榜上看到刚才那局分数已计入总积分。

### 花名册管理

23. 作为房主，我点击页面上的浮动按钮打开"花名册管理"弹窗，需输入房主密码。
24. 作为房主，密码正确后弹窗显示所有已注册玩家的列表。
25. 作为房主，我能在花名册中添加新玩家（输入名字），这样第一次来的朋友可以加入。
26. 作为房主，我能在花名册中删除玩家，删除时系统提示"该操作会从花名册移除，但历史对局记录保留"，需二次确认。
27. 作为房主，我能在花名册中修改玩家名字（比如改花名），历史对局记录中的名字不受影响（通过 player_id 关联）。
28. 作为房主，花名册管理弹窗关闭后排名榜自动刷新，反映最新的玩家信息。

### 赛季管理

29. 作为房主，我点击页面上的浮动按钮打开"赛季管理"弹窗，需输入房主密码。
30. 作为房主，密码正确后弹窗显示当前赛季信息（名称、开始日期、已打对局数）和历史赛季列表。
31. 作为房主，如果没有活跃赛季，我看到"当前无活跃赛季"和一个"新建赛季"按钮。
32. 作为房主，我点击"新建赛季"，输入赛季名称（如"2026秋季赛"），确认后创建新赛季并设为活跃。
33. 作为房主，我点击"结束当前赛季"，系统提示"结束后该赛季排名归档，新赛季将从零开始"，需二次确认。
34. 作为房主，赛季结束后历史排名保留可查，新对局记入新赛季。
35. 作为房主，我能在赛季管理弹窗中查看已结束赛季的最终排名。
36. 作为房主，赛季管理弹窗关闭后排名榜自动刷新，显示当前活跃赛季的排名。

### 作品集集成

37. 作为站长，作品集主页的项目卡 2 需更新为"国战积分系统"，标签"工具 · 国战"，描述"国战积分系统 · 排名计分 · 赛季追踪 · Cloudflare D1"。
38. 作为站长，项目卡 2 的 `data-href` 指向 `./scoring.html`，点击整卡跳转到积分页面。
39. 作为站长，项目卡 2 的源码按钮指向 GitHub 仓库 `MenglongFan/MenglongFan.github.io`。

## Implementation Decisions

### 架构

- **前端**：`scoring.html` 单文件 HTML/CSS/JS，部署在 GitHub Pages（`menglongfan.github.io/scoring.html`），三国水墨风格。
- **后端**：Cloudflare Worker（JavaScript），部署在 Cloudflare 边缘网络，提供 REST API。
- **数据库**：Cloudflare D1（真正的 SQLite），免费额度 5GB 存储、500万行读/天、10万行写/天，无需信用卡。
- **跨域**：Worker 配置 CORS 头允许 `https://menglongfan.github.io` 域名访问。

### 数据模型

四张表，通过外键关联：

```sql
CREATE TABLE players (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE seasons (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  started_at TEXT DEFAULT (datetime('now')),
  ended_at   TEXT,
  is_active  INTEGER DEFAULT 1
);

CREATE TABLE matches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id    INTEGER NOT NULL REFERENCES seasons(id),
  player_count INTEGER NOT NULL,
  played_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE match_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id    INTEGER NOT NULL REFERENCES matches(id),
  player_id   INTEGER NOT NULL REFERENCES players(id),
  rank        INTEGER NOT NULL,      -- 1 = 最后存活，N = 先出局
  is_survivor INTEGER DEFAULT 0,    -- 1 = 存活（冠军段），0 = 被淘汰
  score       INTEGER NOT NULL       -- 存活者 = 死亡人数+1，死者 = 死亡人数..1 递减
);
```

### API 契约

所有写操作需在请求头携带 `X-House-Key` 进行房主密码验证。

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/standings` | 无 | 返回当前活跃赛季的排名榜（总积分降序） |
| GET | `/api/standings?season_id=N` | 无 | 返回指定赛季的排名榜 |
| GET | `/api/players` | 无 | 返回花名册全部玩家 |
| GET | `/api/seasons` | 无 | 返回赛季列表（活跃在前，历史在后） |
| GET | `/api/player/:id/details` | 无 | 返回该玩家当前赛季逐局得分明细 |
| POST | `/api/match` | 房主密码 | 录入一局成绩 |
| POST | `/api/player` | 房主密码 | 添加玩家 |
| PUT | `/api/player/:id` | 房主密码 | 修改玩家名字 |
| DELETE | `/api/player/:id` | 房主密码 | 删除玩家（历史记录保留） |
| POST | `/api/season` | 房主密码 | 新建赛季 |
| POST | `/api/season/:id/end` | 房主密码 | 结束赛季 |

#### POST /api/match 请求体

```json
{
  "season_id": 1,
  "results": [
    {"player_id": 1, "rank": 1, "is_survivor": 1},
    {"player_id": 2, "rank": 1, "is_survivor": 1},
    {"player_id": 3, "rank": 1, "is_survivor": 1},
    {"player_id": 4, "rank": 4, "is_survivor": 0},
    {"player_id": 5, "rank": 5, "is_survivor": 0},
    {"player_id": 6, "rank": 6, "is_survivor": 0},
    {"player_id": 7, "rank": 7, "is_survivor": 0},
    {"player_id": 8, "rank": 8, "is_survivor": 0}
  ]
}
```

Worker 收到后自行计算 score：死亡人数 = player_count - 存活人数；存活者 score = 死亡人数 + 1；死者 score 从死亡人数递减至 1。

### 积分公式

- 死亡人数 D = 总人数 - 存活人数
- 存活者得分 = D + 1
- 死者得分 = 按 rank 从 D 递减至 1（rank 越大得分越低）
- 例：8 人局，3 人存活 5 人死亡 → 存活者各得 6 分，死者依次 5/4/3/2/1 分

### 房主密码

- 密码存储为 Worker 环境变量（`HOUSE_KEY`），不出现在前端代码中。
- 前端通过请求头 `X-House-Key` 传递，Worker 比对验证。
- 密码错误时返回 401，前端提示"密码错误"。

### 视觉风格

- 三国水墨风格：墨色主背景、米白/竹青文字、朱砂红强调色。
- 排名榜呈竹简/卷轴视觉隐喻，第一名有"武将榜首"的仪式感标记。
- 弹窗使用半透明遮罩 + 水墨边框风格。
- 字体：标题用毛笔风字体（如 Ma Shan Zheng），正文用宋体/思源宋体。
- 响应式设计：手机全屏使用，桌面端居中限宽。

### 弹窗模式

- 排名榜作为全屏主视图常驻。
- 三个浮动按钮（录入成绩、花名册、赛季管理）固定在右下角。
- 点击触发弹窗，弹窗内完成操作后关闭，主视图自动刷新。
- 同时只打开一个弹窗。

## Testing Decisions

### 测试切面

单一切面：**Cloudflare Worker API**。所有业务逻辑通过 HTTP API 调用验证，不测试实现细节。

### 测试原则

- 只测外部行为：HTTP 请求 → HTTP 响应 + 数据库状态变化。
- 不测内部函数实现细节（如不直接 import Worker 内部的计算函数，而是通过 API 调用间接验证）。
- 测试用例覆盖：积分公式正确性（各种存活/死亡组合）、花名册 CRUD、赛季生命周期、房主密码鉴权、错误输入处理。

### 测试模块

- **积分计算**：5 人局到 10 人局，各种存活人数组合，验证 score 值正确。
- **鉴权**：无密码/错误密码访问写接口 → 401；正确密码 → 200。
- **赛季生命周期**：新建 → 录入对局 → 结束 → 新建 → 历史排名保留。
- **花名册**：添加 → 修改名字 → 删除（历史记录不受影响）。
- **排名查询**：多局累计积分正确排名，同分玩家排序稳定。

### 测试工具

- 使用 `wrangler dev` 本地运行 Worker + D1 模拟。
- 测试脚本可用 Node.js + fetch 或 Vitest，取决于项目偏好。当前项目无测试基础设施，新建最小测试配置即可。

## Out of Scope

- **武将记录**：不记录每局玩家使用的武将，只记淘汰顺序和积分。
- **阵营录入**：不录入魏/蜀/吴/群信息，阵营仅作线下叙事。
- **用户账号系统**：不实现注册/登录，只有共享房主密码。
- **实时同步**：不做 WebSocket 实时推送，录入后手动刷新或自动 refetch。
- **多语言**：只做中文界面。
- **历史对局明细查看（Q20 展开）**：列为二期功能，一期只做排名榜总积分展示。但数据模型已预留 match_results 表，二期只需前端开发。
- **数据导出**：不提供 CSV/Excel 导出功能。
- **统计图表**：不提供积分走势图等可视化。

## Further Notes

- 项目部署流程：(1) 在 Cloudflare 创建 D1 数据库并执行建表 SQL；(2) 创建 Worker 并绑定 D1 + 设置环境变量；(3) 将 `scoring.html` 推送到 GitHub Pages 仓库。
- 房主密码应足够复杂避免猜到，但不需要加密存储——它是 Worker 环境变量，不暴露在前端。
- D1 免费额度对 5-10 人桌游场景绰绰有余：每天 500 万行读、10 万行写，一局录入约 10 行写入。
- 如未来需要多设备实时同步，可平滑升级到 Cloudflare Durable Objects 或增加 WebSocket 支持，不影响前端架构。
- 作品集主页 `index.html` 中项目卡 2 需同步更新内容（名称、标签、描述、data-href）。
