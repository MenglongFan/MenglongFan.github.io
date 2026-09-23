# 国战积分系统 · 部署指南

## 1. 安装 wrangler

```bash
npm install -g wrangler
wrangler login
```

## 2. 创建 D1 数据库

```bash
cd worker
wrangler d1 create guozhan-scoring
```

将返回的 `database_id` 填入 `wrangler.toml`。

## 3. 执行建表 SQL

```bash
cd worker
wrangler d1 execute guozhan-scoring --remote --file=schema.sql
for f in migration-*.sql; do wrangler d1 execute guozhan-scoring --remote --file="$f"; done
```

`--remote` 不能省。省了会静默打到本地 miniflare 的空库上，看起来成功、线上其实没动。

迁移按编号顺序跑。`migration-001` 里的 `ALTER TABLE players ADD COLUMN avatar_url`
在当前 `schema.sql` 下会报 `duplicate column name` —— 那是预期的，`schema.sql` 是
**当前**的表结构，列增删类迁移自然会撞上，其余语句照常执行。

## 4. 设置房主密码

```bash
wrangler secret put HOUSE_KEY
```

输入你的房主密码（如 `sanguo2026`），密码不会出现在代码中。

本地沙盒另用 `worker/.dev.vars`（已在 `.gitignore` 里）：

```
HOUSE_KEY=local-sandbox-key
```

## 5. 部署 Worker

```bash
wrangler deploy
```

部署成功后会得到 Worker URL（如 `https://guozhan-scoring.menglongfan.workers.dev`）。

## 6. 前端 API 地址

前端是 React 应用，源码在 `react-app/`，地址写在 `react-app/src/lib/api.js`：

```js
const API_BASE = import.meta.env.VITE_API_BASE || 'https://guozhan-scoring.menglongfan.workers.dev'
```

不传 `VITE_API_BASE` 时行为与写死一致。要对着本地沙盒跑前端时用环境变量覆盖，
**不要手改这一行**（改了很容易忘了改回来，把 localhost 发上线）：

```bash
VITE_API_BASE=http://127.0.0.1:8787 npm run build
```

（2026-09-21 起旧的单文件版 `scoring.html` 已下线，不再是前端。）

## 7. 构建并推送前端

`scoring/` 是**提交进仓库的构建产物**，GitHub Pages 直接从它提供服务。
源码改动后必须重新构建并同步过去（`react-app/dist` 已被 gitignore，不会自动同步）：

```bash
cd react-app
npm run build
grep -c '127.0.0.1:8787' dist/assets/index-*.js   # 必须是 0，否则你把沙盒地址发上线了
rm -rf ../scoring/assets && cp -R dist/. ../scoring/
cd ..
git add scoring index.html
git commit -m "国战积分系统：前端更新"
git push
```

应用用 `HashRouter` 且 `vite.config.js` 里 `base: './'`，
所以 `/scoring/` 这个目录路径能直接工作，**不需要任何服务端重写规则**。

## 8. 测试

罚金算法有测试，不需要任何依赖或框架：

```bash
node worker/test/fines.test.mjs
```

它把 `calculateBottomThreeFines` 从 `src/index.js` 里切出来跑，断言三件事：
每个赛季罚金总额恒为 30 元、同一并列组内各人金额最多差 1 分、没有负数。
另外穷举 2445 组输入与旧实现逐分比对 —— 凡是并列组**没有**跨过末三位边界的，
新旧结果必须完全一致（保证这次改动只影响该影响的地方）。

改 `src/index.js` 时注意别动两个锚点（`const TIER_AMOUNTS_CENTS` 与
`// 获取当前奖池余额`），测试靠它们定位函数；锚点没了测试会直接报错退出。

## 9. 验证

- 打开 `https://menglongfan.github.io/scoring/`
- 首页作品集的项目卡 2 整卡点击也应跳到这里（`data-href="./scoring/"`）
- 底部导航依次检查：积分榜 / 录入 / 赛季 / 奖池 / 花名册
- 录入需先在「赛季」页新建赛季（无进行中赛季时录入会被拒绝）
