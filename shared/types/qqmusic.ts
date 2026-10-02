import type { Playlist } from "./player";

export interface QMSong {
  id: string;
  mid?: string;
  mediaMid?: string;
  name: string;
  artist: string;
  artists?: Array<{ mid?: string; name?: string }>;
  album?: string;
  albumMid?: string;
  cover?: string;
  coverOriginal?: string;
  duration: number;
  pay?: {
    payalbum?: number;
    payplay?: number;
    pay_play?: number;
    pay_month?: number;
    price_album?: number;
  };
  size128?: number;
  size320?: number;
  sizeApe?: number;
  sizeFlac?: number;
  sizeOgg?: number;
  sizeHiRes?: number;
  hiResSampleRate?: number;
  hiResBitDepth?: number;
}

/** QQ 歌单访问 ID 与管理目录 ID 分开保存 */
export interface QQMusicPlaylist extends Playlist {
  dirId?: number;
}

export interface QQMusicPlaylistPage {
  playlist: QQMusicPlaylist;
  songs: QMSong[];
  total: number;
  hasMore: boolean;
}

/** 账号收藏列表的轻量分页结果 */
export interface QQMusicPage<T> {
  items: T[];
  hasMore: boolean;
}
