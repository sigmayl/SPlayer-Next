import type { Ref } from "vue";
import type { Collection } from "@/types/collection";
import { useOnlineUser } from "@/composables/useOnlineUser";
import { toast } from "@/composables/useToast";

/** 网易云与 QQ 音乐歌单、专辑收藏入口 */
export const useCollectionSubscribe = (collection: Ref<Collection | null>) => {
  const { t } = useI18n();
  const userStore = useOnlineUser(() => collection.value?.source);
  const busy = ref(false);

  /** 当前是否已收藏 */
  const isSubscribed = computed(() => {
    const current = collection.value;
    if (!current || (current.source !== "netease" && current.source !== "qqmusic")) return false;
    if (current.type === "playlist") {
      return userStore.value.subscribedPlaylists.some((item) => item.id === current.id);
    }
    if (current.type === "album") {
      return userStore.value.albums.some((item) => item.id === current.id);
    }
    return false;
  });

  /** 是否显示收藏按钮：支持网易云与 QQ 音乐，且不是自建（自建无法再"收藏"） */
  const available = computed(() => {
    const current = collection.value;
    if (!current || (current.source !== "netease" && current.source !== "qqmusic")) return false;
    if (current.type === "playlist") {
      return !userStore.value.createdPlaylists.some((item) => item.id === current.id);
    }
    if (current.type === "album") return true;
    return false;
  });

  /** 切换收藏状态 */
  const toggle = async (): Promise<void> => {
    const current = collection.value;
    if (!current || busy.value || !available.value) return;
    busy.value = true;
    try {
      const next = !isSubscribed.value;
      if (current.type === "playlist") {
        await userStore.value.togglePlaylistSubscribe(current.id, next);
      } else if (current.type === "album") {
        await userStore.value.toggleAlbumSubscribe(current.id, next);
      }
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : t("liked.toast.failed");
      toast.error(message);
    } finally {
      busy.value = false;
    }
  };

  return { available, isSubscribed, busy, toggle };
};
