import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";

const mock = vi.hoisted(() => ({ request: vi.fn(), enabled: true, generation: 0, uin: "123" }));
vi.mock("@main/store", () => ({ store: { get: () => mock.enabled } }));
vi.mock("@main/utils/logger", () => ({ playerLog: { warn: vi.fn() } }));
vi.mock("@main/apis/qqmusic/core/request", () => ({
  qmRequest: mock.request,
  getQQMusicUin: () => mock.uin,
  getQQMusicSessionGeneration: () => mock.generation,
}));
vi.mock("node:perf_hooks", () => ({
  performance: { now: () => Date.now() },
  default: { performance: { now: () => Date.now() } },
}));
import { obtainFreeModeUrl, onTrackLoaded, onState, onEnded } from "./qqmusicFreeMode";
const liteComm = {
  ct: 11,
  cv: "22060005",
  v: "22060005",
  versionCode: 22060005,
  tmeAppID: "ztelite",
};
const track: Track = {
  id: "MID",
  extId: "456",
  source: "qqmusic",
  title: "测试",
  artists: [],
  duration: 260000,
};

beforeEach(() => {
  onEnded();
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  mock.enabled = true;
  mock.generation++;
  mock.uin = "123";
  mock.request.mockReset().mockImplementation(async (_module, method) => {
    if (method === "QueryHandselVipInfo") return { vip_end_time: 0 };
    if (method === "HandselVipListenTime") return { vip_end_time: (Date.now() + 60_000) / 1000 };
    if (method === "CgiGetTempVkey")
      return { data: { MEDIA: { purl: "https://old-cdn/song", result: 0 } } };
    if (method === "Obtain")
      if (method === "CgiGetTempVkey") return { data: { MEDIA: { purl: "song", result: 0 } } };
    return { tracks: [{ songid: 456, control: { ppurl: "timestamp_duration_signature-1" } }] };
    return { msg: "ok" };
  });
});
afterEach(() => {
  onEnded();
  vi.useRealTimers();
});

describe("QQ 免费听授权与流水", () => {
  it("并发解析只激活一次，次数、场景和类型符合实机领取协议", async () => {
    const urls = await Promise.all([
      obtainFreeModeUrl(456, "MID", "MEDIA"),
      obtainFreeModeUrl(456, "MID", "MEDIA"),
    ]);
    expect(urls).toEqual([
      "https://isure.stream.qqmusic.qq.com/song",
      "https://isure.stream.qqmusic.qq.com/song",
    ]);
    const rewards = mock.request.mock.calls.filter((call) => call[1] === "HandselVipListenTime");
    expect(rewards).toHaveLength(1);
    expect(rewards[0]).toEqual([
      "music.qqmusiclite.MtHandselVipSvr",
      "HandselVipListenTime",
      {
        order_id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        reward_time: 1,
        client_request_time: Date.now(),
        scene: 0,
        type: 1,
        multi_rewards: { "1": 1 },
        extra_reward_times: 0,
      },
      { lite: true, write: true, comm: liteComm },
    ]);
    expect(mock.request).toHaveBeenCalledWith(
      "music.qqmusiclite.MtLimitFreeSvr",
      "Obtain",
      { songid: [456], need_ppurl: true },
      { lite: true, comm: liteComm },
    );
    await obtainFreeModeUrl(456, "MID", "MEDIA");
    expect(
      mock.request.mock.calls.filter((call) => call[1] === "HandselVipListenTime"),
    ).toHaveLength(1);
  });

  it("已有权益直接取链接，到期后才重新领取", async () => {
    mock.request.mockImplementation(async (_module, method) => {
      if (method === "QueryHandselVipInfo" || method === "HandselVipListenTime")
        return { vip_end_time: (Date.now() + 20_000) / 1000 };
      if (method === "CgiGetTempVkey") return { data: { MEDIA: { purl: "song", result: 0 } } };
      return { tracks: [{ songid: 456, control: { ppurl: "timestamp_duration_signature-1" } }] };
    });
    await obtainFreeModeUrl(456, "MID", "MEDIA");
    expect(mock.request.mock.calls.some((call) => call[1] === "HandselVipListenTime")).toBe(false);
    await vi.advanceTimersByTimeAsync(20_001);
    await obtainFreeModeUrl(456, "MID", "MEDIA");
    expect(
      mock.request.mock.calls.filter((call) => call[1] === "HandselVipListenTime"),
    ).toHaveLength(1);
  });

  it("解析与预加载不报流水，实际播放第十秒上报一次，暂停保留累计时长", async () => {
    const url = await obtainFreeModeUrl(456, "MID", "MEDIA");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mock.request.mock.calls.some((call) => call[1] === "ListenVipSongInFreeMode")).toBe(
      false,
    );
    onTrackLoaded(track, url, true);
    await vi.advanceTimersByTimeAsync(6000);
    onState(false);
    await vi.advanceTimersByTimeAsync(30_000);
    onState(true);
    await vi.advanceTimersByTimeAsync(4000);
    expect(mock.request).toHaveBeenLastCalledWith(
      "music.qqmusiclite.MtReportSvr",
      "ListenVipSongInFreeMode",
      { song_id: 456, duration: 10 },
      { lite: true, write: true, comm: liteComm },
    );
    const count = mock.request.mock.calls.filter(
      (call) => call[1] === "ListenVipSongInFreeMode",
    ).length;
    expect(count).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(
      mock.request.mock.calls.filter((call) => call[1] === "ListenVipSongInFreeMode"),
    ).toHaveLength(1);
    onEnded();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(
      mock.request.mock.calls.filter((call) => call[1] === "ListenVipSongInFreeMode"),
    ).toHaveLength(1);
  });

  it("开关关闭、未登录与旧账号链接均不调用免费听流水", async () => {
    mock.enabled = false;
    await expect(obtainFreeModeUrl(456, "MID", "MEDIA")).rejects.toThrow("未开启");
    expect(mock.request).not.toHaveBeenCalled();
    mock.enabled = true;
    mock.uin = "0";
    await expect(obtainFreeModeUrl(456, "MID", "MEDIA")).rejects.toThrow("登录");
    mock.uin = "123";
    const url = await obtainFreeModeUrl(456, "MID", "MEDIA");
    mock.generation++;
    onTrackLoaded(track, url, true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mock.request.mock.calls.some((call) => call[1] === "ListenVipSongInFreeMode")).toBe(
      false,
    );
  });

  it("tempVkey 原样传递，按媒体 mid 取结果并替换返回的 CDN host", async () => {
    expect(await obtainFreeModeUrl(456, "MID", "MEDIA")).toBe(
      "https://isure.stream.qqmusic.qq.com/song",
    );
    expect(mock.request).toHaveBeenCalledWith(
      "music.vkey.GetVkey",
      "CgiGetTempVkey",
      {
        guid: expect.any(String),
        uin: "123",
        songlist: [
          { mediamid: "MEDIA", songMID: "MID", tempVkey: "timestamp_duration_signature-1" },
        ],
      },
      { lite: true, comm: liteComm },
    );
  });

  it.each([{}, { tracks: [] }, { tracks: [{ songid: 456, control: { ppurl: "" } }] }])(
    "空授权串不请求 CgiGetTempVkey",
    async (response) => {
      const original = mock.request.getMockImplementation()!;
      mock.request.mockImplementation((module, method, ...args) =>
        method === "Obtain" ? Promise.resolve(response) : original(module, method, ...args),
      );
      await expect(obtainFreeModeUrl(456, "MID", "MEDIA")).rejects.toThrow("未返回授权串");
      expect(mock.request.mock.calls.some((call) => call[1] === "CgiGetTempVkey")).toBe(false);
    },
  );

  it("普通链接和非 QQ 歌曲不启动流水，免费听一次播放不重复上报", async () => {
    const url = await obtainFreeModeUrl(456, "MID", "MEDIA");
    onTrackLoaded(track, "https://normal/song", true);
    await vi.advanceTimersByTimeAsync(20_000);
    onTrackLoaded({ ...track, source: "netease" }, url, true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mock.request.mock.calls.some((call) => call[1] === "ListenVipSongInFreeMode")).toBe(
      false,
    );
    onTrackLoaded(track, url, true);
    await vi.advanceTimersByTimeAsync(10_000);
    onState(false);
    onState(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(
      mock.request.mock.calls.filter((call) => call[1] === "ListenVipSongInFreeMode"),
    ).toHaveLength(1);
  });

  it("领取流水不能重复重试，服务端拒绝时仍每首只尝试一次", async () => {
    const url = await obtainFreeModeUrl(456, "MID", "MEDIA");
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((module, method, ...args) =>
      method === "ListenVipSongInFreeMode"
        ? Promise.reject(new Error("rejected"))
        : original(module, method, ...args),
    );
    onTrackLoaded(track, url, true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(
      mock.request.mock.calls.filter((call) => call[1] === "ListenVipSongInFreeMode"),
    ).toHaveLength(1);
  });

  it("权益发放失败不请求歌曲链接", async () => {
    mock.request.mockResolvedValue({ vip_end_time: 0 });
    await expect(obtainFreeModeUrl(456, "MID", "MEDIA")).rejects.toThrow("未激活");
    expect(mock.request.mock.calls.some((call) => call[1] === "Obtain")).toBe(false);
  });

  it("在途激活发生账号切换，不沿用旧权益获取歌曲", async () => {
    let finish!: (value: unknown) => void;
    mock.request.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const request = obtainFreeModeUrl(456, "MID", "MEDIA");
    mock.generation++;
    finish({ vip_end_time: (Date.now() + 60_000) / 1000 });
    await expect(request).rejects.toThrow("会话已变化");
    expect(mock.request).toHaveBeenCalledTimes(1);
  });
});
