import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { createPinia, setActivePinia } from "pinia";
import type { Track } from "@shared/types/player";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(async () => {}),
  daily: vi.fn(),
  qq: vi.fn(),
}));
vi.mock("localforage", () => ({
  default: { createInstance: () => ({ getItem: mocks.get, setItem: mocks.set }) },
}));
vi.mock("@/apis/recommend/netease", () => ({ fetchDailySongs: mocks.daily }));
vi.mock("@/apis/qqmusic", () => ({ qqmusicCall: mocks.qq }));
const user = reactive({ profile: { userId: 123 } as { userId: number } | null });
const status = reactive({ onlinePlatform: "netease" });
vi.mock("./user", () => ({ useUserStore: () => user }));
vi.mock("./status", () => ({ useStatusStore: () => status }));
import { useDataStore } from "./data";
const track: Track = { id: "1", source: "netease", title: "NCM", artists: [], duration: 1000 };

beforeEach(() => {
  setActivePinia(createPinia());
  user.profile = { userId: 123 };
  status.onlinePlatform = "netease";
  mocks.get.mockReset().mockResolvedValue(null);
  mocks.set.mockClear();
  mocks.daily.mockReset();
  mocks.qq.mockReset();
});

describe("每日推荐账号与平台隔离", () => {
  it("NCM 在途结果不会覆盖切换后的 QM，旧请求不会清掉新请求锁", async () => {
    let finish!: (tracks: Track[]) => void;
    mocks.daily.mockImplementation(
      () =>
        new Promise<Track[]>((resolve) => {
          finish = resolve;
        }),
    );
    const data = useDataStore();
    data.setPlatformProfile("qqmusic", {
      userId: "456",
      nickname: "QM",
      avatarUrl: "",
      isVip: false,
    });
    const old = data.ensureDailyRecommend();
    await vi.waitFor(() => expect(mocks.daily).toHaveBeenCalled());
    status.onlinePlatform = "qqmusic";
    mocks.qq.mockResolvedValue({
      songs: [{ id: "789", mid: "MID", name: "QM", artist: "", duration: 2000 }],
    });
    await data.ensureDailyRecommend();
    finish([track]);
    await old;
    expect(data.dailyRecommend.map((track) => track.source)).toEqual(["qqmusic"]);
    expect(mocks.set).toHaveBeenCalledWith(
      "daily-recommend-archive:qqmusic:456",
      expect.any(Array),
    );
    expect(mocks.set).not.toHaveBeenCalledWith(
      "daily-recommend-archive:netease:123",
      expect.anything(),
    );
  });
  it("退出账号立即清空每日推荐与历史", async () => {
    mocks.daily.mockResolvedValue([track]);
    const data = useDataStore();
    await data.ensureDailyRecommend();
    expect(data.dailyRecommend).toHaveLength(1);
    user.profile = null;
    expect(data.dailyRecommend).toEqual([]);
    expect(data.dailyHistory).toEqual([]);
  });
  it("同日复用缓存，强制刷新会重新请求", async () => {
    mocks.daily.mockResolvedValue([track]);
    const data = useDataStore();
    await data.ensureDailyRecommend();
    await data.ensureDailyRecommend();
    expect(mocks.daily).toHaveBeenCalledTimes(1);
    await data.ensureDailyRecommend(true);
    expect(mocks.daily).toHaveBeenCalledTimes(2);
  });
});
