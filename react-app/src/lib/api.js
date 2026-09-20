// 三国杀国战积分系统 · API 工具模块

const API_BASE = 'https://guozhan-scoring.menglongfan.workers.dev';

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

// 处理头像 URL（相对路径补全）
export function resolveAvatarUrl(url) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  // 如果是相对路径如 ./avatars/1-fanmenglong.jpg，直接返回
  // 在同域部署时相对路径可以正常工作
  return url;
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
