import {
  qmRequest,
  getQQMusicCookies,
  getQQMusicUin,
  getQQMusicSessionGeneration,
} from "../core/request";
import songList from "./song_list";
import type { QMSong } from "@shared/types/qqmusic";
import type { QMModule } from "../core/types";
import type { Album, Artist, Playlist } from "@shared/types/player";
import type { QQMusicPage, QQMusicPlaylist } from "@shared/types/qqmusic";

interface OwnedPlaylist {
  dirId: number;
  dirName: string;
  tid: number | string;
  songNum: number;
  picUrl?: string;
  desc?: string;
}

const identity = (): { uin: string; euin: string } => {
  const uin = getQQMusicUin();
  if (uin === "0") throw new Error("请先登录 QQ 音乐");
  return { uin, euin: getQQMusicCookies().euin || uin };
};

const owned = async (): Promise<OwnedPlaylist[]> => {
  const { uin } = identity();
  const data = await qmRequest<{ v_playlist: OwnedPlaylist[] }>(
    "music.musicasset.PlaylistBaseRead",
    "GetPlaylistByUin",
    { uin },
  );
  return data.v_playlist;
};

/** 目录 ID 与全局歌单 ID 不同，写入前由服务端列表核验归属 */
const resolveOwned = async (
  id: unknown,
  allowLiked = true,
): Promise<OwnedPlaylist & { generation: number }> => {
  const generation = getQQMusicSessionGeneration();
  const playlist = (await owned()).find((item) => String(item.tid) === String(id));
  if (!playlist || playlist.dirId === 202 || (!allowLiked && playlist.dirId === 201))
    throw new Error("不可管理此歌单");
  if (generation !== getQQMusicSessionGeneration()) throw new Error("QM 账号会话已变化");
  return { ...playlist, generation };
};

export const user_playlists: QMModule = async () =>
  (await owned()).map((item): QQMusicPlaylist => ({
    id: String(item.tid),
    dirId: item.dirId,
    name: item.dirName,
    cover: item.picUrl,
    description: item.desc,
    trackCount: item.songNum,
  }));

export const user_albums: QMModule = async ({ offset = 0, limit = 100 }) => {
  const data = await qmRequest<{
    v_list: Array<{
      mid: string;
      name: string;
      songnum: number;
      v_singer?: Array<{ name: string }>;
    }>;
    hasmore: number;
  }>("music.musicasset.AlbumFavRead", "CgiGetAlbumFavInfo", {
    euin: identity().euin,
    offset,
    size: limit,
  });
  return {
    items: data.v_list.map((item) => ({
      id: item.mid,
      name: item.name,
      trackCount: item.songnum,
      cover: `https://y.gtimg.cn/music/photo_new/T002R300x300M000${item.mid}.jpg`,
      artist: item.v_singer?.map((singer) => singer.name).join(" / "),
    })),
    hasMore: Boolean(data.hasmore),
  } satisfies QQMusicPage<Album>;
};

/** 关注列表只传递展示字段，避免 IPC 携带完整勋章与按钮资源 */
export const user_artists: QMModule = async ({ offset = 0, limit = 100 }) => {
  const data = await qmRequest<{ List: Array<{ MID: string; Name: string }>; HasMore: boolean }>(
    "music.concern.RelationList",
    "GetFollowSingerList",
    { HostUin: identity().euin, From: offset, Size: limit },
  );
  return {
    items: data.List.map(({ MID, Name }) => ({
      id: MID,
      name: Name,
      avatar: `https://y.gtimg.cn/music/photo_new/T001R300x300M000${MID}.jpg`,
    })),
    hasMore: data.HasMore,
  } satisfies QQMusicPage<Artist>;
};

export const user_subscribed_playlists: QMModule = async ({ offset = 0, limit = 100 }) => {
  const data = await qmRequest<{
    v_list: Array<{ tid: number; name: string; logo?: string; songnum: number }>;
    hasmore: number;
  }>("music.musicasset.PlaylistFavRead", "CgiGetPlaylistFavInfo", {
    uin: identity().euin,
    offset,
    size: limit,
  });
  return {
    items: data.v_list.map((item) => ({
      id: String(item.tid),
      name: item.name,
      cover: item.logo,
      trackCount: item.songnum,
    })),
    hasMore: Boolean(data.hasmore),
  } satisfies QQMusicPage<Playlist>;
};

/** 写接口的结果码可能位于 retCode、result 或 code */
const write = async (
  module: string,
  method: string,
  param: Record<string, unknown>,
  generation = getQQMusicSessionGeneration(),
): Promise<Record<string, unknown>> => {
  if (generation !== getQQMusicSessionGeneration()) throw new Error("QM 账号会话已变化");
  identity();
  const data = await qmRequest<Record<string, unknown>>(module, method, param, { write: true });
  const code = data.retCode ?? data.result ?? data.code;
  if (code !== 0) throw new Error(`QQ ${method} 失败: ${String(code)}`);
  return data;
};

export const playlist_create: QMModule = async ({ name }) => {
  if (typeof name !== "string" || !name.trim()) throw new Error("歌单名称不能为空");
  return write("music.musicasset.PlaylistBaseWrite", "AddPlaylist", { dirName: name.trim() });
};
export const playlist_delete: QMModule = async ({ id }) => {
  const playlist = await resolveOwned(id, false);
  return write(
    "music.musicasset.PlaylistBaseWrite",
    "DelPlaylist",
    { dirId: playlist.dirId },
    playlist.generation,
  );
};
export const playlist_update: QMModule = async ({ id, name, description }) => {
  const playlist = await resolveOwned(id, false);
  if (typeof name !== "string" || !name.trim() || typeof description !== "string")
    throw new Error("歌单编辑参数无效");
  return write(
    "music.musicasset.PlaylistBaseWrite",
    "EditPlaylist",
    {
      dirId: playlist.dirId,
      mask: 3,
      dirNewName: name.trim(),
      dirNewDesc: description,
    },
    playlist.generation,
  );
};
export const playlist_tracks: QMModule = async ({ id, ids, add }) => {
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || typeof add !== "boolean")
    throw new Error("歌曲操作参数无效");
  const playlist = await resolveOwned(id);
  const requested = new Set(ids.map(String));
  const existing = new Set<string>();
  let offset = 0;
  while (true) {
    if (playlist.generation !== getQQMusicSessionGeneration()) throw new Error("QM 账号会话已变化");
    const page = (await songList({ id: playlist.tid, offset, limit: 100 })) as {
      songs: QMSong[];
      total: number;
    };
    if (playlist.generation !== getQQMusicSessionGeneration()) throw new Error("QM 账号会话已变化");
    for (const song of page.songs) if (song.mid && requested.has(song.mid)) existing.add(song.mid);
    offset += page.songs.length;
    if (!page.songs.length || offset >= page.total || existing.size === requested.size) break;
  }
  const targets = [...requested].filter((mid) => (add ? !existing.has(mid) : existing.has(mid)));
  if (!targets.length) return { count: 0 };
  const songs: Array<{ songId: number; songType: number }> = [];
  for (const mid of targets) {
    if (playlist.generation !== getQQMusicSessionGeneration()) throw new Error("QM 账号会话已变化");
    const song = await qmRequest<{ track_info: { id: number } }>(
      "music.pf_song_detail_svr",
      "get_song_detail_yqq",
      { song_type: 0, song_mid: mid },
    );
    if (!song.track_info?.id) throw new Error("无法解析歌曲数字 ID");
    songs.push({ songId: song.track_info.id, songType: 0 });
  }
  const data = await write(
    "music.musicasset.PlaylistDetailWrite",
    add ? "AddSonglist" : "DelSonglist",
    {
      dirId: playlist.dirId,
      tid: Number(playlist.tid),
      bFmtUtf8: true,
      v_songInfo: songs,
    },
    playlist.generation,
  );
  return { ...data, count: targets.length };
};
export const playlist_subscribe: QMModule = async ({ id, subscribe }) => {
  if (!/^\d+$/.test(String(id ?? "")) || typeof subscribe !== "boolean")
    throw new Error("歌单收藏参数无效");
  const data = await write(
    "music.musicasset.PlaylistFavWrite",
    subscribe ? "FavPlaylist" : "CancelFavPlaylist",
    { uin: identity().euin, v_playlistId: [Number(id)] },
  );
  if (Array.isArray(data.v_failedPlaylistId) && data.v_failedPlaylistId.length)
    throw new Error("QQ 歌单收藏失败");
  return data;
};

/** 手机端歌单广场推荐 */
export const recommend_playlists: QMModule = async ({ offset = 0, limit = 20 }) => {
  const data = await qmRequest<{
    List: Array<{
      Playlist: {
        basic: {
          tid: number;
          title: string;
          song_cnt: number;
          cover: { small_url: string };
          creator: { nick: string };
        };
      };
    }>;
  }>("music.playlist.PlaylistSquare", "GetRecommendFeed", { From: offset, Size: limit });
  return data.List.map(({ Playlist: { basic } }) => ({
    id: String(basic.tid),
    name: basic.title,
    cover: basic.cover.small_url,
    trackCount: basic.song_cnt,
    owner: basic.creator.nick,
  }));
};
