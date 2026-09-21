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
wrangler d1 execute guozhan-scoring --file=schema.sql
```

## 4. 设置房主密码

```bash
wrangler secret put HOUSE_KEY
```

输入你的房主密码（如 `sanguo2026`），密码不会出现在代码中。

## 5. 部署 Worker

```bash
wrangler deploy
```

部署成功后会得到 Worker URL（如 `https://guozhan-scoring.menglongfan.workers.dev`）。

## 6. 更新前端 API 地址

前端是 React 应用，源码在 `react-app/`，API 地址写在 `react-app/src/lib/api.js`：

```js
const API_BASE = 'https://guozhan-scoring.menglongfan.workers.dev';
```

（2026-09-21 起旧的单文件版 `scoring.html` 已下线，不再是前端。）

## 7. 构建并推送前端

`scoring/` 是**提交进仓库的构建产物**，GitHub Pages 直接从它提供服务。
源码改动后必须重新构建并同步过去（`react-app/dist` 已被 gitignore，不会自动同步）：

```bash
cd react-app
npm run build
rm -rf ../scoring/assets && cp -R dist/. ../scoring/
cd ..
git add scoring index.html
git commit -m "国战积分系统：前端更新"
git push
```

应用用 `HashRouter` 且 `vite.config.js` 里 `base: './'`，
所以 `/scoring/` 这个目录路径能直接工作，**不需要任何服务端重写规则**。

## 8. 验证

- 打开 `https://menglongfan.github.io/scoring/`
- 首页作品集的项目卡 2 整卡点击也应跳到这里（`data-href="./scoring/"`）
- 底部导航依次检查：积分榜 / 录入 / 赛季 / 奖池 / 花名册
- 录入需先在「赛季」页新建赛季（无进行中赛季时录入会被拒绝）
