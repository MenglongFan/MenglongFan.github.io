// 三国杀国战积分系统 · API 工具模块

// 后端地址。默认走线上 Worker；本地起沙盒（wrangler dev）验证时用
//   VITE_API_BASE=http://127.0.0.1:8787 npm run build
// 覆盖掉，这样能对着本地库把「建赛季 / 暂存 / 恢复 / 结束」整条链路点一遍，
// 不用拿线上真实赛季当试验品。不传这个变量时行为与以前完全一致。
const API_BASE = import.meta.env.VITE_API_BASE || 'https://guozhan-scoring.menglongfan.workers.dev';

// 全局 houseKey，由 auth 模块设置
let houseKey = '';

export function setHouseKey(key) {
  houseKey = key;
}

export function getHouseKey() {
  return houseKey;
}

export function clearHouseKey() {
  houseKey = '';
}

// 核心 API 调用函数
export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (opts.auth && houseKey) {
    headers['X-House-Key'] = houseKey;
  }
  const res = await fetch(API_BASE + path, { ...opts, headers });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || '请求失败');
  }
  return data;
}

// 获取 ISO 周
export function getISOWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
}

// 默认赛季名称
export function getDefaultSeasonName() {
  const now = new Date();
  const year = now.getFullYear();
  const week = getISOWeek(now);
  return `${year}年第${week}周`;
}

// 赛季三态：active 进行中 / paused 已暂存 / ended 已结束
//
// 后端 seasons.status 是唯一真相。这里对旧响应兜一次底（老 Worker 只返回 is_active），
// 免得前后端版本错开的那段时间页面直接白屏 —— 部署不是原子的，这个窗口真实存在。
export const SEASON_STATUS_TEXT = { active: '进行中', paused: '已暂存', ended: '已结束' }

export function seasonStatus(season) {
  if (!season) return null
  return season.status || (season.is_active ? 'active' : 'ended')
}

// 处理头像 URL：站内相对路径统一解析为根绝对路径，
// 这样应用部署在任意子路径（如 /scoring/）下头像都不会 404
export function resolveAvatarUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('//') || url.startsWith('data:')) return url;
  if (url.startsWith('/')) return url;
  return '/' + url.replace(/^\.?\//, '');
}

// 导出 API 端点常量
export const API_ENDPOINTS = {
  STANDINGS: '/api/standings',
  PLAYER_DETAILS: '/api/player',
  MATCH: '/api/match',
  SEASONS: '/api/seasons',
  SEASON_PLAYERS: '/api/season',
  SEASON_END: '/api/season',
  PLAYERS: '/api/players',
  PLAYER: '/api/player',
  PRIZE_SUMMARY: '/api/prize-pool/summary',
  PRIZE_TRANSACTIONS: '/api/prize-pool/transactions',
  PRIZE_WITHDRAW: '/api/prize-pool/withdraw',
  AUTH: '/api/auth',
};
