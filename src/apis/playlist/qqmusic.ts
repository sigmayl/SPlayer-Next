import type { Playlist, Track } from "@shared/types/player";
import { qqmusic as qmApi } from "@/apis/qqmusic";
import { qqSongsToTracks, type QMSong } from "@/utils/format/qqmusic";

interface PlaylistResponse {
  code?: number;
  message?: string;
  id?: string | number;
  name?: string;
  description?: string;
  creator?: string;
  cover?: string;
  total?: number;
  songs?: QMSong[];
}

export const fetchQQMusicPlaylist = async (
  id: string,
  fallbackName: string,
): Promise<{ playlist: Playlist; tracks: Track[] }> => {
  const body = await qmApi.song_list<PlaylistResponse>({ id });
  if (body.code !== 200) throw new Error(body.message || `QM 歌单请求失败: ${body.code}`);
  const songs = [...(body.songs ?? [])];
  while (songs.length < (body.total ?? songs.length)) {
    const page = await qmApi.song_list<PlaylistResponse>({ id, offset: songs.length, limit: 100 });
    if (page.code !== 200) throw new Error(page.message || "QM 歌单分页失败");
    if (!page.songs?.length) break;
    songs.push(...page.songs);
  }
  const tracks = qqSongsToTracks(songs);
  return {
    playlist: {
      id: String(body.id ?? id),
      name: body.name || fallbackName,
      cover: body.cover || tracks[0]?.cover,
      description: body.description,
      owner: body.creator,
      trackCount: body.total ?? tracks.length,
    },
    tracks,
  };
};
