import { qmRequest, getQQMusicUin, getQQMusicSessionGeneration } from "../core/request";
import type { QMModule } from "../core/types";
import type { QMSong, QQMusicPlaylistPage } from "@shared/types/qqmusic";
import { formatSingerName } from "../core/config";

interface DailyResponse {
  code: number;
  dirinfo: {
    id: string | number;
    title: string;
    desc?: string;
    picurl?: string;
    songnum: number;
    host_nick?: string;
  };
  songlist: Array<{
    id: number;
    mid: string;
    title: string;
    interval: number;
    singer?: Array<{ mid?: string; name?: string }>;
    album?: { mid?: string; name?: string };
    file?: Record<string, number | string>;
    pay?: QMSong["pay"];
  }>;
  total_song_num?: number;
}

/** 手机端每日 30 首，歌曲同时保留数字 ID 与 mid */
export const daily_recommend: QMModule = async () => {
  if (getQQMusicUin() === "0") throw new Error("请先登录 QQ 音乐");
  const data = await qmRequest<DailyResponse>(
    "music.qqmusiclite.MtRecommendSvr",
    "GetDaily30",
    {
      disstid: 0,
      dirid: 202,
      onlysonglist: 0,
      song_begin: 0,
      song_num: 2147483647,
      userinfo: 1,
      pic_dpi: 800,
      orderlist: 1,
    },
    { lite: true },
  );
  if (data.code !== 0 || !data.dirinfo || !Array.isArray(data.songlist)) {
    throw new Error(`QQ 每日推荐失败: ${data.code}`);
  }
  const songs: QMSong[] = data.songlist.map((song) => ({
    id: String(song.id),
    mid: song.mid,
    name: song.title,
    artist: formatSingerName(song.singer),
    artists: song.singer,
    album: song.album?.name,
    albumMid: song.album?.mid,
    duration: song.interval * 1000,
    pay: song.pay,
    mediaMid: String(song.file?.media_mid ?? ""),
    size128: Number(song.file?.size_128mp3 ?? 0),
    size320: Number(song.file?.size_320mp3 ?? 0),
    sizeFlac: Number(song.file?.size_flac ?? 0),
  }));
  return {
    playlist: {
      id: String(data.dirinfo.id),
      dirId: 202,
      name: data.dirinfo.title,
      description: data.dirinfo.desc,
      cover: data.dirinfo.picurl,
      trackCount: data.dirinfo.songnum,
      owner: data.dirinfo.host_nick,
    },
    songs,
    total: data.total_song_num ?? songs.length,
    hasMore: false,
  } satisfies QQMusicPlaylistPage;
};

/** 收藏写入必须检查业务结果，不能只依赖 musicu 信封 */
export const album_subscribe: QMModule = async ({ mid, subscribe }) => {
  if (typeof mid !== "string" || !mid || typeof subscribe !== "boolean")
    throw new Error("专辑参数无效");
  if (getQQMusicUin() === "0") throw new Error("请先登录 QQ 音乐");
  const data = await qmRequest<{
    result: number;
    reason?: string;
    v_failedAlbumId?: unknown[];
    v_failedAlbumMid?: unknown[];
  }>(
    "music.musicasset.AlbumFavWrite",
    subscribe ? "FavAlbum" : "CancelFavAlbum",
    { v_albumMid: [mid] },
    { lite: true, write: true },
  );
  if (data.result !== 0 || data.v_failedAlbumId?.length || data.v_failedAlbumMid?.length) {
    throw new Error(data.reason || `QQ 专辑收藏失败: ${data.result}`);
  }
  return data;
};

/** 关注接口使用歌手数字 ID，不接受 mid */
export const artist_subscribe: QMModule = async ({ id, subscribe }) => {
  const generation = getQQMusicSessionGeneration();
  if (typeof id !== "string" || !id || typeof subscribe !== "boolean")
    throw new Error("歌手参数无效");
  if (!/^\d+$/.test(id)) {
    const songs = await qmRequest<{
      songList?: Array<{ songInfo?: { singer?: Array<{ id: number; mid: string }> } }>;
    }>("musichall.song_list_server", "GetSingerSongList", {
      singerMid: id,
      order: 1,
      begin: 0,
      num: 1,
    });
    const singer = songs.songList?.[0]?.songInfo?.singer?.find((singer) => singer.mid === id);
    if (!singer?.id) throw new Error("无法解析歌手数字 ID");
    id = String(singer.id);
  }
  if (getQQMusicUin() === "0") throw new Error("请先登录 QQ 音乐");
  if (generation !== getQQMusicSessionGeneration()) throw new Error("QM 账号会话已变化");
  const data = await qmRequest<{ code: number }>(
    "Concern.ConcernSystemServer",
    "cgi_concern_user_v2",
    {
      userinfo: { usertype: 1, userid: String(id) },
      opertype: subscribe ? 0 : 1,
      source: 0,
    },
    { lite: true, write: true },
  );
  if (data.code !== 0) throw new Error(`QQ 歌手关注失败: ${data.code}`);
  return data;
};

export const recent_play: QMModule = async ({ type = 2, updateTime = Date.now() }) => {
  if (![2, 3, 4].includes(Number(type))) throw new Error("最近播放类型无效");
  return qmRequest(
    "music.musicasset.PlayRecentlyRead",
    "GetPlayRecentlyInfo",
    { type, updateTime },
    { lite: true },
  );
};

/** 限免凭证来自服务端播放授权，不能替代普通播放上报 */
export const report_consume: QMModule = async ({ songid, time_consume, report_str }) => {
  if (
    !/^\d+$/.test(String(songid ?? "")) ||
    typeof time_consume !== "number" ||
    time_consume <= 0 ||
    typeof report_str !== "string" ||
    !report_str
  )
    throw new Error("限免消费参数无效");
  return qmRequest(
    "music.qqmusiclite.MtLimitFreeSvr",
    "ReportConsume",
    { songid: Number(songid), time_consume, report_str },
    { lite: true, write: true },
  );
};

export const report_free_vip: QMModule = async ({ song_id }) => {
  if (!/^\d+$/.test(String(song_id ?? ""))) throw new Error("歌曲 ID 无效");
  return qmRequest(
    "music.qqmusiclite.MtReportSvr",
    "ListenVipSongInFreeMode",
    { song_id: Number(song_id), duration: 10 },
    { lite: true, write: true },
  );
};
