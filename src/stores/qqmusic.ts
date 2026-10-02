import { qqmusicCall } from "@/apis/qqmusic";
import { useDataStore } from "./data";
import type { PlatformProfile } from "@shared/types/platform";
import { qqSongsToTracks } from "@/utils/format/qqmusic";
import type { Album, Artist, Playlist, Track } from "@shared/types/player";
import type { QMSong, QQMusicPage, QQMusicPlaylist } from "@shared/types/qqmusic";

/** QQ 账号内容独立维护，账号改变后丢弃旧请求回包 */
export const useQQMusicStore = defineStore("qqmusic", () => {
  const data = useDataStore();
  const profile = computed(() => data.getPlatformProfile("qqmusic"));
  const isLoggedIn = computed(() => !!profile.value);
  const playlists = shallowRef<QQMusicPlaylist[]>([]);
  const subscribedPlaylists = shallowRef<Playlist[]>([]);
  const albums = shallowRef<Album[]>([]);
  const artists = shallowRef<Artist[]>([]);
  const likedPlaylistTracks = shallowRef<Track[]>([]);
  const likedPlaylistLoading = ref(false);
  const createdPlaylists = computed(() => playlists.value.filter((item) => item.dirId !== 202));
  const likedPlaylistId = computed(
    () => playlists.value.find((item) => item.dirId === 201)?.id ?? null,
  );
  const likedSongIds = computed(() => new Set(likedPlaylistTracks.value.map((track) => track.id)));
  let generation = 0;
  let likedLoading: Promise<void> | null = null;

  const check = (epoch: number): void => {
    if (epoch !== generation || !isLoggedIn.value) throw new Error("QQ 账号已变化");
  };
  const clearContent = (): void => {
    generation++;
    playlists.value = [];
    subscribedPlaylists.value = [];
    albums.value = [];
    artists.value = [];
    likedPlaylistTracks.value = [];
    likedPlaylistLoading.value = false;
    likedLoading = null;
  };
  const refreshPlaylists = async (): Promise<void> => {
    const epoch = generation;
    const list = await qqmusicCall<QQMusicPlaylist[]>("user_playlists");
    check(epoch);
    playlists.value = list;
  };
  const ensureLikedPlaylist = async (force = false): Promise<void> => {
    if (!isLoggedIn.value) return;
    if (likedLoading) return likedLoading;
    if (!force && likedPlaylistTracks.value.length) return;
    const epoch = generation;
    likedPlaylistLoading.value = true;
    const request = (async () => {
      if (!likedPlaylistId.value) await refreshPlaylists();
      if (!likedPlaylistId.value) return;
      const songs: QMSong[] = [];
      let offset = 0;
      while (true) {
        const page = await qqmusicCall<{ songs: QMSong[]; total: number }>("song_list", {
          id: likedPlaylistId.value,
          offset,
          limit: 100,
        });
        check(epoch);
        songs.push(...page.songs);
        offset += page.songs.length;
        if (!page.songs.length || offset >= page.total) break;
      }
      check(epoch);
      likedPlaylistTracks.value = qqSongsToTracks(songs);
    })();
    likedLoading = request;
    try {
      await request;
    } finally {
      if (epoch === generation) {
        likedLoading = null;
        likedPlaylistLoading.value = false;
      }
    }
  };
  const loadContent = async (): Promise<void> => {
    if (!isLoggedIn.value) return;
    const epoch = generation;
    const fetchPages = async <T>(name: string): Promise<T[]> => {
      const list: T[] = [];
      for (let offset = 0; ; offset += 100) {
        const page = await qqmusicCall<QQMusicPage<T>>(name, { offset, limit: 100 });
        check(epoch);
        list.push(...page.items);
        if (!page.hasMore || !page.items.length) return list;
      }
    };
    const results = await Promise.allSettled([
      refreshPlaylists().then(() => ensureLikedPlaylist()),
      fetchPages<Album>("user_albums").then((list) => {
        check(epoch);
        albums.value = list;
      }),
      fetchPages<Playlist>("user_subscribed_playlists").then((list) => {
        check(epoch);
        subscribedPlaylists.value = list;
      }),
      fetchPages<Artist>("user_artists").then((list) => {
        check(epoch);
        artists.value = list;
      }),
    ]);
    for (const result of results)
      if (result.status === "rejected" && epoch === generation)
        console.warn("[qqmusic] 内容加载失败", result.reason);
  };
  const isLiked = (id: string): boolean => likedSongIds.value.has(id);
  const toggleLike = async (id: string): Promise<boolean> => {
    const epoch = generation;
    try {
      if (!likedPlaylistId.value) await refreshPlaylists();
      if (!likedPlaylistId.value) throw new Error("QQ 喜欢歌单不可用");
      await qqmusicCall("playlist_tracks", {
        id: likedPlaylistId.value,
        ids: [id],
        add: !isLiked(id),
      });
      check(epoch);
      await ensureLikedPlaylist(true);
      return true;
    } catch (error) {
      console.warn("[qqmusic] 喜欢操作失败", error);
      return false;
    }
  };
  const createPlaylist = async (name: string, _privacy?: number): Promise<Playlist> => {
    const epoch = generation;
    const result = await qqmusicCall<{ result: { tid: number; dirName: string; dirId: number } }>(
      "playlist_create",
      { name },
    );
    check(epoch);
    await refreshPlaylists();
    return {
      id: String(result.result.tid),
      name: result.result.dirName,
      dirId: result.result.dirId,
    } as QQMusicPlaylist;
  };
  const deletePlaylist = async (id: string): Promise<void> => {
    await qqmusicCall("playlist_delete", { id });
    await refreshPlaylists();
  };
  const updatePlaylist = async (
    id: string,
    fields: { name?: string; description?: string },
  ): Promise<void> => {
    const old = playlists.value.find((item) => item.id === id);
    await qqmusicCall("playlist_update", {
      id,
      name: fields.name ?? old?.name,
      description: fields.description ?? old?.description ?? "",
    });
    await refreshPlaylists();
  };
  const changeTracks = async (id: string, ids: string[], add: boolean): Promise<number> => {
    const result = await qqmusicCall<{ count: number }>("playlist_tracks", { id, ids, add });
    await refreshPlaylists();
    if (id === likedPlaylistId.value) await ensureLikedPlaylist(true);
    return result.count;
  };
  const toggleAlbumSubscribe = async (id: string, subscribe: boolean): Promise<void> => {
    await qqmusicCall("album_subscribe", { mid: id, subscribe });
    await loadContent();
  };
  const toggleArtistSubscribe = async (id: string, subscribe: boolean): Promise<void> => {
    await qqmusicCall("artist_subscribe", { id, subscribe });
    await loadContent();
  };
  const togglePlaylistSubscribe = async (id: string, subscribe: boolean): Promise<void> => {
    await qqmusicCall("playlist_subscribe", { id, subscribe });
    await loadContent();
  };

  watch(
    () => profile.value?.userId,
    () => {
      clearContent();
      if (isLoggedIn.value) void loadContent();
    },
    { immediate: true },
  );
  void qqmusicCall<{ loggedIn: boolean; profile?: PlatformProfile }>("user_detail")
    .then((response) =>
      data.setPlatformProfile("qqmusic", response.loggedIn ? (response.profile ?? null) : null),
    )
    .catch((error) => console.warn("[qqmusic] 账号状态读取失败", error));

  return {
    profile,
    isLoggedIn,
    playlists,
    createdPlaylists,
    subscribedPlaylists,
    albums,
    artists,
    likedPlaylistId,
    likedPlaylistTracks,
    likedPlaylistLoading,
    likedSongIds,
    isLiked,
    loadContent,
    ensureLikedPlaylist,
    clearContent,
    toggleLike,
    createPlaylist,
    deletePlaylist,
    updatePlaylist,
    addTracksToPlaylist: (id: string, ids: string[]) => changeTracks(id, ids, true),
    removeTracksFromPlaylist: (id: string, ids: string[]) => changeTracks(id, ids, false),
    toggleAlbumSubscribe,
    toggleArtistSubscribe,
    togglePlaylistSubscribe,
  };
});
