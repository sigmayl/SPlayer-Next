/** QQ 音乐主进程服务，缓存按会话隔离 */

import { createHash } from "node:crypto";
import { modules } from "./modules";
import {
  clearQQMusicCookies,
  mergeQQMusicCookies,
  getQQMusicSessionGeneration,
} from "./core/request";
import type { QMParams } from "./core/types";

export { clearQQMusicCookies, mergeQQMusicCookies };

/** 2 分钟响应缓存 */
const DEFAULT_TTL = 2 * 60 * 1000;
const MAX_ENTRIES = 200;

interface CacheEntry {
  value: unknown;
  expireAt: number;
}

const cache = new Map<string, CacheEntry>();

/** 不缓存的实时接口 */
const NON_CACHEABLE: ReadonlySet<string> = new Set([
  "user_playlists",
  "song_list",
  "user_albums",
  "user_artists",
  "user_subscribed_playlists",
  "playlist_create",
  "playlist_delete",
  "playlist_update",
  "playlist_tracks",
  "playlist_subscribe",
  "daily_recommend",
  "album_subscribe",
  "artist_subscribe",
  "recent_play",
  "report_consume",
  "report_free_vip",
  "user_detail",
  "song_url",
  "comment",
  "login_qr_key",
  "login_qr_check",
]);

const hashParams = (params: unknown): string =>
  createHash("md5")
    .update(JSON.stringify(params ?? {}))
    .digest("hex")
    .slice(0, 8);

const cacheGet = (key: string): unknown => {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expireAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
};

const cacheSet = (key: string, value: unknown, ttl = DEFAULT_TTL): void => {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expireAt: Date.now() + ttl });
};

export const clearQQMusicCache = (): void => {
  cache.clear();
};

/**
 * 调用任意 QM API
 * @param name  见 modules/index.ts 中的 key（search / song_info / lyric / match / hot_search / leaderboard / song_list / user_detail / song_url）
 * @param params 业务参数；不想命中缓存可传 `timestamp: Date.now()`
 */
export const callQQMusic = async (name: string, params: QMParams = {}): Promise<any> => {
  // hasOwn 守卫
  const fn = Object.hasOwn(modules, name) ? modules[name] : undefined;
  if (!fn) throw new Error(`unknown qm api: ${name}`);

  if (NON_CACHEABLE.has(name)) return fn(params);

  const generation = getQQMusicSessionGeneration();
  const key = `${generation}|${name}|${hashParams(params)}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;

  const value = await fn(params);
  if (generation === getQQMusicSessionGeneration()) cacheSet(key, value);
  return value;
};
