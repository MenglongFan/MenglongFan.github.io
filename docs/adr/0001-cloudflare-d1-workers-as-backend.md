# ADR 0001: 后端选型 — Cloudflare D1 + Workers

**状态**: 已接受
**日期**: 2026-09-17

## 背景

三国杀积分系统需要所有访问者看到真实积分数据，不能只存浏览器本地。前端部署在 GitHub Pages（纯静态托管），需要一个免费后端提供数据持久化和多设备访问。

可选方案：
- **Cloudflare D1 + Workers**: 真正的 SQLite 引擎，Worker 跑在 Cloudflare 边缘网络，提供 REST API。免费额度：5GB 存储、500万行读/天、10万行写/天。无需信用卡。
- **Turso**: LibSQL（SQLite 分支），前端直接调 HTTP API。免费额度更大（5亿行读/月），但 API token 暴露在前端代码中。
- **Supabase**: PostgreSQL 后端，自带认证、实时订阅等功能。功能最全但对本场景过重。

## 决策

选择 **Cloudflare D1 + Workers**。

## 理由

1. **真正的 SQLite** — 与用户最初提出的数据存储需求一致
2. **API token 不暴露** — Worker 作为中间层，数据库凭证不出现在前端代码中
3. **免费额度远超需求** — 5-10 人桌游积分场景，每日读写量极低
4. **部署简单** — wrangler CLI 一键部署 Worker，与 GitHub Pages 前端职责分离
5. **无信用卡要求** — 降低使用门槛

## 后果

- 前端通过 fetch 调用 Worker API（跨域需配置 CORS）
- 需要维护一个 Worker 文件（JavaScript）作为后端逻辑
- 如果未来需要多设备实时同步或用户认证，可平滑升级到 Cloudflare 的其他服务
