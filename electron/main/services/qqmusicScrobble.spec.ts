import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";

const state = vi.hoisted(() => ({ enabled: true, generation: 0, uin: "123", now: 0 }));
vi.mock("node:fs", () => ({
  default: { readFileSync: () => JSON.stringify({ id: "00000000-0000-0000-0000-000000000000" }) },
}));
vi.mock("@main/utils/paths", () => ({ configDir: "/test" }));
vi.mock("@main/utils/proxy", () => ({
  fetchWithProxy: (...args: unknown[]) => fetchMock(...args),
  getNetworkProxyUrl: () => null,
}));
vi.mock("@main/store", () => ({ store: { get: () => state.enabled } }));
vi.mock("@main/utils/logger", () => ({ playerLog: { debug: vi.fn(), warn: vi.fn() } }));
vi.mock("node:perf_hooks", () => ({
  performance: { now: () => state.now },
  default: { performance: { now: () => state.now } },
}));
vi.mock("@main/apis/qqmusic/core/request", () => ({
  getQQMusicUin: () => state.uin,
  getQQMusicSessionGeneration: () => state.generation,
  getQQMusicReportSession: async () => ({
    uin: state.uin,
    sid: "session",
    generation: state.generation,
  }),
}));
import { onTrackLoaded, onState, onEnded } from "./qqmusicScrobble";
const track: Track = {
  id: "MID",
  extId: "456",
  source: "qqmusic",
  title: "测试",
  artists: [],
  duration: 260000,
};
const fetchMock = vi.fn();

beforeEach(() => {
  state.enabled = false;
  onEnded();
  Object.assign(state, { enabled: true, generation: 0, uin: "123", now: 0 });
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ code: 0 }) });
  vi.stubGlobal("fetch", fetchMock);
});

describe("QQ 播放结算", () => {
  it("暂停不计时，切歌和结束只结算一次，发送独立 SuperSet 信封", async () => {
    onTrackLoaded(
      track,
      { provider: "qqmusic", originId: "daily", originType: "page" },
      260000,
      true,
    );
    state.now = 45200;
    onState(false);
    state.now = 90000;
    onState(true);
    state.now = 95000;
    onEnded();
    onEnded();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(url).toBe("https://stat.y.qq.com/sdk/fcgi-bin/sdk.fcg");
    expect(body.comm).toBeUndefined();
    expect(options.headers.Cookie).toBeUndefined();
    expect(body.common).toMatchObject({ c_uin: "123", c_session_id: "session" });
    expect(body.common.authst).toBeUndefined();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      content_id: "456",
      song_id: "MID",
      play_duration: "50200",
      content_duration: "260000",
      from: "1,9,",
      event_code: "event_xmplay",
    });
  });

  it("新歌加载结算旧歌，seek 不依赖源时间位置", async () => {
    onTrackLoaded(track, undefined, 260000, true);
    state.now = 1000;
    onTrackLoaded({ ...track, id: "MID2", extId: "789" }, undefined, 100000, false);
    state.now = 50000;
    onEnded();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).items[0].play_duration).toBe("1000");
  });

  it("账号切换、未登录、非 QQ 歌曲与关闭上报不发送", async () => {
    onTrackLoaded(track, undefined, 260000, true);
    state.now = 1000;
    state.generation++;
    onEnded();
    onTrackLoaded({ ...track, source: "netease" }, undefined, 260000, true);
    state.now = 2000;
    onEnded();
    state.uin = "0";
    onTrackLoaded(track, undefined, 260000, true);
    state.now = 3000;
    onEnded();
    state.uin = "123";
    onTrackLoaded(track, undefined, 260000, true);
    state.now = 4000;
    state.enabled = false;
    onEnded();
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("请求失败不自动重试", async () => {
    fetchMock.mockRejectedValue(new Error("断网"));
    onTrackLoaded(track, undefined, 260000, true);
    state.now = 1000;
    onEnded();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
