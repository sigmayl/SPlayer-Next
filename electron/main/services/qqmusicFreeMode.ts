import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Track } from "@shared/types/player";
import { store } from "@main/store";
import { playerLog } from "@main/utils/logger";
import {
  qmRequest,
  getQQMusicUin,
  getQQMusicSessionGeneration,
} from "@main/apis/qqmusic/core/request";

interface Benefit {
  vip_end_time?: number | null;
  vip_remain_time?: number;
}
interface Account {
  uin: string;
  generation: number;
}
interface FreePlay extends Account {
  songId: number;
  elapsed: number;
  startedAt: number | null;
  reported: boolean;
}

const LITE_COMM = {
  ct: 11,
  cv: "22060005",
  v: "22060005",
  versionCode: 22060005,
  tmeAppID: "ztelite",
};
const MODULE = "music.qqmusiclite.MtHandselVipSvr";
const REPORT_AT_MS = 10_000;
const urls = new Map<string, Account & { songId: number }>();
let benefit: (Account & { expireAt: number }) | null = null;
let activation: { account: Account; promise: Promise<void> } | null = null;
let current: FreePlay | null = null;
let timer: NodeJS.Timeout | null = null;

const isCurrentAccount = (account: Account): boolean =>
  account.uin === getQQMusicUin() && account.generation === getQQMusicSessionGeneration();

/** 服务端 epoch 秒转换为内部毫秒 */
const expiryMs = (value: number | null | undefined): number => (value ?? 0) * 1000;

/** 同一账号并发解析只领取一次，写请求不做网络重试 */
const ensureBenefit = async (account: Account): Promise<void> => {
  if (!isCurrentAccount(account)) throw new Error("QQ 账号会话已变化");
  if (benefit && isCurrentAccount(benefit) && benefit.expireAt > Date.now()) return;
  if (activation && isCurrentAccount(activation.account)) return activation.promise;
  const promise = (async () => {
    if (!benefit || !isCurrentAccount(benefit)) {
      const data = await qmRequest<Benefit>(
        MODULE,
        "QueryHandselVipInfo",
        {},
        { lite: true, comm: LITE_COMM },
      );
      if (!isCurrentAccount(account)) throw new Error("QQ 账号会话已变化");
      benefit = { ...account, expireAt: expiryMs(data.vip_end_time) };
    }
    if (benefit.expireAt > Date.now()) return;
    const now = Date.now();
    const timestamp = BigInt(now) * 10_000n + 0x01b21dd213814000n;
    const nonce = randomBytes(8);
    nonce[0] = (nonce[0] & 0x3f) | 0x80;
    nonce[2] |= 0x01;
    const timeLow = (timestamp & 0xffffffffn).toString(16).padStart(8, "0");
    const timeMid = ((timestamp >> 32n) & 0xffffn).toString(16).padStart(4, "0");
    const timeHigh = (((timestamp >> 48n) & 0xfffn) | 0x1000n).toString(16).padStart(4, "0");
    const orderId = `${timeLow}-${timeMid}-${timeHigh}-${nonce.subarray(0, 2).toString("hex")}-${nonce.subarray(2).toString("hex")}`;
    const data = await qmRequest<Benefit>(
      MODULE,
      "HandselVipListenTime",
      {
        order_id: orderId,
        reward_time: 1,
        client_request_time: now,
        scene: 0,
        type: 1,
        multi_rewards: { "1": 1 },
        extra_reward_times: 0,
      },
      { lite: true, write: true, comm: LITE_COMM },
    );
    if (!isCurrentAccount(account)) throw new Error("QQ 账号会话已变化");
    const expireAt = expiryMs(data.vip_end_time);
    if (expireAt <= Date.now()) throw new Error("QQ 免费听权益未激活");
    benefit = { ...account, expireAt };
  })();
  const operation = { account, promise };
  activation = operation;
  try {
    await promise;
  } finally {
    if (activation === operation) activation = null;
  }
};

/**
 * 普通解析失败后的免费听兜底，仅缓存有界的链接身份供实际播放识别
 * @param songId - QQ 数字歌曲 ID
 * @param mid - 歌曲 mid
 * @param mediaMid - 媒体文件 mid
 * @returns 已获授权的免费听链接
 */
export const obtainFreeModeUrl = async (
  songId: number,
  mid: string,
  mediaMid: string,
): Promise<string> => {
  if (!store.get("system.qqmusicFreeModeEnabled")) throw new Error("QQ 免费听未开启");
  const account = { uin: getQQMusicUin(), generation: getQQMusicSessionGeneration() };
  if (account.uin === "0") throw new Error("请先登录 QQ 音乐");
  if (!Number.isSafeInteger(songId) || songId <= 0) throw new Error("QQ 数字歌曲 ID 无效");
  if (!mid || !mediaMid) throw new Error("QQ 歌曲媒体 ID 缺失");
  await ensureBenefit(account);
  const data = await qmRequest<{
    tracks?: Array<{ songid?: number | null; control?: { ppurl?: string | null } | null }>;
  }>(
    "music.qqmusiclite.MtLimitFreeSvr",
    "Obtain",
    { songid: [songId], need_ppurl: true },
    { lite: true, comm: LITE_COMM },
  );
  if (!isCurrentAccount(account) || !store.get("system.qqmusicFreeModeEnabled"))
    throw new Error("QQ 免费听会话已变化");
  const tempVkey = data.tracks?.find((track) => Number(track.songid) === songId)?.control?.ppurl;
  if (!tempVkey) throw new Error("QQ 免费听未返回授权串");
  const resolved = await qmRequest<{ data?: Record<string, { purl?: string; result?: number }> }>(
    "music.vkey.GetVkey",
    "CgiGetTempVkey",
    {
      guid: randomUUID(),
      uin: account.uin,
      songlist: [{ mediamid: mediaMid, songMID: mid, tempVkey }],
    },
    { lite: true, comm: LITE_COMM },
  );
  if (!isCurrentAccount(account) || !store.get("system.qqmusicFreeModeEnabled"))
    throw new Error("QQ 免费听会话已变化");
  const item = resolved.data?.[mediaMid];
  if (!item?.purl) throw new Error(`QQ 免费听链接解析失败: ${item?.result ?? "empty"}`);
  const url = `https://isure.stream.qqmusic.qq.com/${item.purl.replace(/^https?:\/\/.*\//, "").replace(/^\//, "")}`;
  if (urls.size >= 32) urls.delete(urls.keys().next().value!);
  urls.set(url, { ...account, songId });
  return url;
};

/** 每首免费听歌曲仅在实际收听累计十秒时上报一次 */
const scheduleReport = (): void => {
  const play = current;
  if (!play || play.startedAt === null || play.reported || timer !== null) return;
  timer = setTimeout(
    () => {
      timer = null;
      if (current !== play || play.startedAt === null) return;
      play.elapsed += performance.now() - play.startedAt;
      play.startedAt = performance.now();
      if (play.elapsed < REPORT_AT_MS) {
        scheduleReport();
        return;
      }
      play.reported = true;
      void (async () => {
        if (!store.get("system.qqmusicFreeModeEnabled") || !isCurrentAccount(play)) return;
        await ensureBenefit(play);
        if (current !== play || !isCurrentAccount(play)) return;
        await qmRequest(
          "music.qqmusiclite.MtReportSvr",
          "ListenVipSongInFreeMode",
          { song_id: play.songId, duration: 10 },
          { lite: true, write: true, comm: LITE_COMM },
        );
        playerLog.debug("[qqmusic-free-mode] 免费听流水已接受", { songId: play.songId });
      })().catch((error) => playerLog.warn("[qqmusic-free-mode] 权益续期或流水上报失败", error));
    },
    Math.max(1, REPORT_AT_MS - play.elapsed),
  );
  timer.unref();
};

/** 播放状态按单调时钟计时，seek 不增加收听时长 */
export const onState = (playing: boolean): void => {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (!current) return;
  if (playing && current.startedAt === null) current.startedAt = performance.now();
  else if (!playing && current.startedAt !== null) {
    current.elapsed += performance.now() - current.startedAt;
    current.startedAt = null;
  }
  if (playing) scheduleReport();
};

/** 切歌、停止、退出后不再为旧曲上报 */
export const onEnded = (): void => {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  current = null;
};

/** 解析和预加载不计流水，只在播放器成功加载免费听链接后启动 */
export const onTrackLoaded = (track: Track | null, source: string, autoPlay: boolean): void => {
  onEnded();
  const entry = urls.get(source);
  if (track?.source !== "qqmusic" || !entry || !isCurrentAccount(entry)) return;
  current = {
    ...entry,
    elapsed: 0,
    startedAt: autoPlay ? performance.now() : null,
    reported: false,
  };
  if (autoPlay) scheduleReport();
};
