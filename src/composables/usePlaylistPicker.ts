import type { Track } from "@shared/types/player";
import type { ContentScope } from "@/types/collection";
import { useOnlineUser } from "@/composables/useOnlineUser";
import { toast } from "@/composables/useToast";

/**
 * 添加到歌单选择器
 * 在线歌曲未登录时拦截并提示，不打开弹窗
 */
export const usePlaylistPicker = () => {
  const user = useOnlineUser(() => tracks.value[0]?.source);
  const { t } = useI18n();

  /** 弹窗开关 */
  const open = ref(false);
  /** 待添加曲目 */
  const tracks = shallowRef<Track[]>([]);
  /** 本地 / 在线 */
  const mode = ref<ContentScope>("local");

  /**
   * 打开添加到歌单弹窗
   * @param items - 待添加曲目，需同源（local 或 netease）
   */
  const openPicker = (items: Track[]): void => {
    if (items.length === 0) return;
    if (items.some((item) => item.source !== items[0].source)) {
      toast.warning(t("liked.toast.unsupported"));
      return;
    }
    tracks.value = items;
    const scope: ContentScope =
      items[0].source === "netease" || items[0].source === "qqmusic" ? "online" : "local";
    if (scope === "online" && !user.value.isLoggedIn) {
      toast.warning(t("liked.toast.needLogin"));
      return;
    }
    tracks.value = items;
    mode.value = scope;
    open.value = true;
  };

  return { open, tracks, mode, openPicker };
};
