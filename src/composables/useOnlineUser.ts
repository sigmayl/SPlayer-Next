import type { MaybeRefOrGetter } from "vue";
import type { OnlinePlatform } from "@shared/types/platform";
import { useUserStore } from "@/stores/user";
import { useQQMusicStore } from "@/stores/qqmusic";
import { useStatusStore } from "@/stores/status";

/** 内容页面按共享选择切换，资源操作按资源自身的平台分发 */
export const useOnlineUser = (platform?: MaybeRefOrGetter<string | undefined>) => {
  const netease = useUserStore();
  const qqmusic = useQQMusicStore();
  const status = useStatusStore();
  const selected = computed<OnlinePlatform>(() =>
    toValue(platform) === "qqmusic" ||
    (platform === undefined && status.onlinePlatform === "qqmusic")
      ? "qqmusic"
      : "netease",
  );
  return computed(() => (selected.value === "qqmusic" ? qqmusic : netease));
};
