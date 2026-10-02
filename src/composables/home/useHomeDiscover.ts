import type { CoverItem } from "@/types/artist";
import { useOnlineUser } from "@/composables/useOnlineUser";
import { useStatusStore } from "@/stores/status";
import { qqmusicCall } from "@/apis/qqmusic";
import type { Playlist } from "@shared/types/player";
import {
  fetchRecommendPlaylists,
  fetchRadarPlaylists,
  fetchArtists,
  fetchNewAlbums,
} from "@/apis/recommend/netease";

/** 首页推荐内容缓存有效期 */
const CACHE_TTL = 30 * 60 * 1000;

/** 首页推荐内容缓存 */
interface DiscoverCache {
  at: number;
  loggedIn: boolean;
  key: string;
  recommend: CoverItem[];
  radar: CoverItem[];
  artists: CoverItem[];
  albums: CoverItem[];
}

/** 模块级缓存，跨页面 / 重新挂载复用 */
let cache: DiscoverCache | null = null;

/** 包裹拉取：失败记日志并回退空数组，单区块失败不影响整体 */
const safe = (label: string, task: Promise<CoverItem[]>): Promise<CoverItem[]> =>
  task.catch((error) => {
    console.warn(`[home] ${label} failed:`, error);
    return [];
  });

/**
 * 首页推荐内容
 *
 * 聚合「推荐歌单 / 雷达 / 歌手 / 新碟」四个区块，统一拉取与缓存
 * 命中缓存（30 分钟内、登录态一致）直接复用，避免重新挂载首页时重复请求
 */
export const useHomeDiscover = () => {
  const { t } = useI18n();
  const user = useOnlineUser();
  const status = useStatusStore();

  /** 推荐歌单 / 专属歌单 */
  const recommendPlaylists = shallowRef<CoverItem[]>([]);
  /** 雷达歌单 */
  const radarPlaylists = shallowRef<CoverItem[]>([]);
  /** 歌手推荐 */
  const artists = shallowRef<CoverItem[]>([]);
  /** 新碟上架 */
  const newAlbums = shallowRef<CoverItem[]>([]);

  /** 推荐歌单标题 */
  const recommendTitle = computed(() =>
    user.value.isLoggedIn ? t("home.recommend.title") : t("home.recommend.titleGuest"),
  );
  /** 推荐歌单副标题 */
  const recommendSubtitle = computed(() =>
    user.value.isLoggedIn ? t("home.recommend.subtitle") : t("home.recommend.subtitleGuest"),
  );

  /** 用缓存填充各区块 */
  const apply = (data: DiscoverCache): void => {
    recommendPlaylists.value = data.recommend;
    radarPlaylists.value = data.radar;
    artists.value = data.artists;
    newAlbums.value = data.albums;
  };

  /** 拉取首页推荐内容 */
  const load = async (): Promise<void> => {
    const loggedIn = user.value.isLoggedIn;
    const platform = status.onlinePlatform;
    const key = `${platform}:${user.value.profile?.userId ?? "guest"}`;
    if (
      cache &&
      cache.key === key &&
      cache.loggedIn === loggedIn &&
      Date.now() - cache.at < CACHE_TTL
    ) {
      apply(cache);
      return;
    }
    if (platform === "qqmusic") {
      apply({ at: 0, key, loggedIn, recommend: [], radar: [], artists: [], albums: [] });
      const playlists = await qqmusicCall<Playlist[]>("recommend_playlists", { limit: 20 }).catch(
        () => [],
      );
      if (key !== `${status.onlinePlatform}:${user.value.profile?.userId ?? "guest"}`) return;
      cache = {
        at: Date.now(),
        key,
        loggedIn,
        recommend: playlists.map((item) => ({
          id: item.id!,
          title: item.name,
          cover: item.cover,
          subtitle: item.owner ?? "",
          trackCount: item.trackCount ?? 0,
        })),
        radar: [],
        artists: [],
        albums: [],
      };
      apply(cache);
      return;
    }
    const [recommend, radar, artistList, albums] = await Promise.all([
      safe("recommend playlists", fetchRecommendPlaylists(loggedIn)),
      loggedIn ? safe("radar playlists", fetchRadarPlaylists()) : Promise.resolve<CoverItem[]>([]),
      safe("artists", fetchArtists()),
      safe("new albums", fetchNewAlbums()),
    ]);
    if (key !== `${status.onlinePlatform}:${user.value.profile?.userId ?? "guest"}`) return;
    cache = { at: Date.now(), key, loggedIn, recommend, radar, artists: artistList, albums };
    apply(cache);
  };

  // 登录态变化
  watch(
    () => [status.onlinePlatform, user.value.profile?.userId],
    () => {
      void load();
    },
  );

  return {
    recommendPlaylists,
    recommendTitle,
    recommendSubtitle,
    radarPlaylists,
    artists,
    newAlbums,
    load,
  };
};
