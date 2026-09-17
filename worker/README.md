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

编辑 `scoring.html`，将 `API_BASE` 替换为你的 Worker URL：

```js
const API_BASE = 'https://guozhan-scoring.menglongfan.workers.dev';
```

## 7. 推送前端

```bash
cd ..
git add scoring.html index.html
git commit -m "国战积分系统：前端页面 + 作品集卡片更新"
git push
```

## 8. 验证

- 打开 `https://menglongfan.github.io/scoring.html`
- 右下角点击日历按钮 → 输入房主密码 → 新建赛季
- 点击花名册按钮 → 添加玩家
- 点击录入按钮 → 选人 → 排序 → 提交
