import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { PlaybackContext, Track } from "@shared/types/player";
import {
  getQQMusicUin,
  getQQMusicSessionGeneration,
  getQQMusicReportSession,
} from "@main/apis/qqmusic/core/request";
import { configDir } from "@main/utils/paths";
import { fetchWithProxy, getNetworkProxyUrl } from "@main/utils/proxy";
import { store } from "@main/store";
import { playerLog } from "@main/utils/logger";

interface Play {
  id: string;
  mid: string;
  duration: number;
  from: string;
  uin: string;
  generation: number;
  elapsed: number;
  startedAt: number | null;
}

const pending = new Set<Promise<void>>();
let current: Play | null = null;
let deviceId: string | undefined;

/** 设备标识持久化，避免每条统计生成不同的客户端身份 */
const getDeviceId = (): string => {
  if (deviceId) return deviceId;
  const file = path.join(configDir, "qqmusic-device.json");
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as { id: string };
    if (typeof saved.id === "string" && saved.id.length === 36) deviceId = saved.id;
  } catch {}
  if (!deviceId) {
    deviceId = randomUUID();
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ id: deviceId }));
  }
  return deviceId;
};

/** SuperSet 独立发送，不包含 musicu 的 comm、cookie 或 authst */
const submit = async (play: Play, playedMs: number): Promise<void> => {
  if (play.generation !== getQQMusicSessionGeneration() || play.uin !== getQQMusicUin()) return;
  const session = await getQQMusicReportSession();
  if (session.generation !== play.generation || session.uin !== play.uin) return;
  const uuid = getDeviceId();
  const now = Date.now();
  const request = getNetworkProxyUrl() ? fetchWithProxy : fetch;
  const response = await request("https://stat.y.qq.com/sdk/fcgi-bin/sdk.fcg", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      common: {
        _appid: "xiaomimusicexpress",
        c_uin: session.uin,
        c_session_id: session.sid,
        c_uid: uuid,
        c_uuid: uuid,
        c_udid: uuid,
        c_openudid: uuid,
        c_app: "com.tencent.qqmusiclite.universal",
        c_account_source: "0",
        c_app_name: "QQ音乐",
        c_app_name_en: "QQMusic",
      },
      items: [
        {
          c_opertime: String(now),
          content_type: "song",
          content_id: play.id,
          content_exactid: play.id,
          song_id: play.mid,
          play_duration: String(Math.round(playedMs)),
          content_duration: String(play.duration),
          playtype: "4",
          from: play.from,
          event_code: "event_xmplay",
          event_id: `${now}${randomUUID()}`,
          _key: "play",
          c_event_type: "1",
          c_client_version: "2.6.0.5",
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`SuperSet HTTP ${response.status}`);
  const data = (await response.json()) as { code?: number };
  if (data.code !== 0) throw new Error(`SuperSet 业务错误: ${data.code}`);
  playerLog.debug("[qqmusic-report] 播放结算已接受", { playedMs: Math.round(playedMs) });
};

/** 结算后立即清空，结束事件与切歌事件不会重复上报 */
export const onEnded = (): void => {
  const play = current;
  current = null;
  if (!play) return;
  const elapsed = play.elapsed + (play.startedAt === null ? 0 : performance.now() - play.startedAt);
  if (elapsed <= 0 || !store.get("system.qqmusicScrobbleEnabled")) return;
  if (pending.size >= 16) {
    playerLog.warn("[qqmusic-report] 在途上报已满，跳过此次结算");
    return;
  }
  const request = submit(play, elapsed).catch((error) =>
    playerLog.warn("[qqmusic-report] 播放结算失败", error),
  );
  pending.add(request);
  void request.finally(() => pending.delete(request));
};

/** 按单调时钟累计真实收听时长，暂停与 seek 不增加时间 */
export const onState = (playing: boolean): void => {
  if (!current) return;
  if (playing && current.startedAt === null) current.startedAt = performance.now();
  else if (!playing && current.startedAt !== null) {
    current.elapsed += performance.now() - current.startedAt;
    current.startedAt = null;
  }
};

/**
 * 替换当前歌曲前先结算上一轮，队列只保留轻量统计字段
 * @param track - 权威歌曲元数据
 * @param context - 播放来源
 * @param durationMs - 引擎确认的毫秒时长
 * @param autoPlay - 是否立即播放
 */
export const onTrackLoaded = (
  track: Track | null,
  context: PlaybackContext | undefined,
  durationMs: number,
  autoPlay: boolean,
): void => {
  onEnded();
  const id = track?.extId ?? track?.id ?? "";
  const uin = getQQMusicUin();
  if (track?.source !== "qqmusic" || !/^\d+$/.test(id) || !track.extId || uin === "0") return;
  current = {
    id,
    mid: track.id,
    duration: durationMs,
    from: context?.originId === "daily" ? "1,9," : "",
    uin,
    generation: getQQMusicSessionGeneration(),
    elapsed: 0,
    startedAt: autoPlay ? performance.now() : null,
  };
};

/** 退出前结算并等待有界的在途请求完成 */
export const flush = async (): Promise<void> => {
  onEnded();
  await Promise.allSettled([...pending]);
};
