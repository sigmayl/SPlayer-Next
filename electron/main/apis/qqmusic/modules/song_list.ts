import { qmRequest, getQQMusicCookies } from "../core/request";
import { formatSingerName } from "../core/config";
import type { QMModule } from "../core/types";
import type { QMSong } from "@shared/types/qqmusic";

interface PlaylistResponse {
  code: number;
  dirinfo: {
    id: string | number;
    title: string;
    desc?: string;
    picurl?: string;
    host_nick?: string;
  };
  total_song_num: number;
  songlist: Array<{
    id: number;
    mid: string;
    title: string;
    interval: number;
    singer?: QMSong["artists"];
    album?: { mid?: string; name?: string };
    file?: Record<string, string | number>;
    pay?: QMSong["pay"];
  }>;
}

/** 手机端歌单详情，允许游客读取公开歌单 */
const songList: QMModule = async ({ id, offset = 0, limit = 100 }) => {
  const data = await qmRequest<PlaylistResponse>("music.srfDissInfo.DissInfo", "CgiGetDiss", {
    disstid: Number(id),
    song_begin: Number(offset),
    song_num: Number(limit),
    onlysonglist: 0,
    userinfo: 1,
    orderlist: 1,
    pic_dpi: 800,
    ...(getQQMusicCookies().euin ? { enc_host_uin: getQQMusicCookies().euin } : {}),
  });
  if (data.code !== 0 || !data.dirinfo || !Array.isArray(data.songlist))
    throw new Error(`QQ 歌单请求失败: ${data.code}`);
  return {
    code: 200,
    id: data.dirinfo.id,
    name: data.dirinfo.title,
    description: data.dirinfo.desc,
    cover: data.dirinfo.picurl,
    creator: data.dirinfo.host_nick,
    total: data.total_song_num,
    songs: data.songlist.map((song): QMSong => ({
      id: String(song.id),
      mid: song.mid,
      name: song.title,
      artist: formatSingerName(song.singer),
      artists: song.singer,
      album: song.album?.name,
      albumMid: song.album?.mid,
      duration: song.interval * 1000,
      mediaMid: String(song.file?.media_mid ?? ""),
      pay: song.pay,
      size128: Number(song.file?.size_128mp3 ?? 0),
      size320: Number(song.file?.size_320mp3 ?? 0),
      sizeFlac: Number(song.file?.size_flac ?? 0),
    })),
  };
};
export default songList;
