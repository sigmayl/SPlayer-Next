import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  enabled: false,
  obtain: vi.fn(),
  request: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@main/store", () => ({ store: { get: () => mock.enabled } }));
vi.mock("@main/services/qqmusicFreeMode", () => ({ obtainFreeModeUrl: mock.obtain }));
vi.mock("../core/request", () => ({
  qmRequest: mock.request,
  getQQMusicCookies: () => ({}),
  getQQMusicUin: () => "123",
  refreshQMCredential: vi.fn(),
}));
vi.mock("@main/utils/logger", () => ({
  coreLog: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
import songUrl from "./song_url";

beforeEach(() => {
  mock.enabled = false;
  mock.obtain.mockReset().mockResolvedValue("https://test/free");
  mock.request
    .mockReset()
    .mockResolvedValue({ track_info: { id: 456, file: { media_mid: "MEDIA" } } });
  mock.fetch
    .mockReset()
    .mockResolvedValue({ json: async () => ({ code: 0, req_0: { code: 0, data: {} } }) });
  vi.stubGlobal("fetch", mock.fetch);
});

describe("QQ 普通解析失败后的免费听兜底", () => {
  it("关闭开关保持原错误，不调用免费听", async () => {
    expect(await songUrl({ mid: "MID" })).toMatchObject({ code: 403 });
    expect(mock.obtain).not.toHaveBeenCalled();
  });
  it("普通直链成功时不查询或激活免费听", async () => {
    mock.enabled = true;
    mock.fetch.mockResolvedValue({
      json: async () => ({
        code: 0,
        req_0: {
          code: 0,
          data: {
            sip: ["https://test/"],
            midurlinfo: [{ filename: "M800MIDMID.mp3", purl: "normal" }],
          },
        },
      }),
    });
    expect(await songUrl({ mid: "MID" })).toMatchObject({
      code: 200,
      data: [{ url: "https://test/normal" }],
    });
    expect(mock.obtain).not.toHaveBeenCalled();
    expect(mock.request).not.toHaveBeenCalled();
  });
  it("失败后使用数字歌曲 ID 获取免费听，网络异常也进入兜底", async () => {
    mock.enabled = true;
    mock.fetch.mockRejectedValue(new Error("network"));
    expect(await songUrl({ mid: "MID", songId: "456", mediaMid: "MEDIA" })).toMatchObject({
      code: 200,
      data: [{ url: "https://test/free", freeMode: true }],
    });
    expect(mock.obtain).toHaveBeenCalledWith(456, "MID", "MEDIA");
    expect(mock.request).not.toHaveBeenCalled();
  });
  it("缺少数字 ID 时用 mid 查询，不把 mid 当数字主键", async () => {
    mock.enabled = true;
    await songUrl({ mid: "MID" });
    expect(mock.request).toHaveBeenCalledWith("music.pf_song_detail_svr", "get_song_detail_yqq", {
      song_type: 0,
      song_mid: "MID",
    });
    expect(mock.obtain).toHaveBeenCalledWith(456, "MID", "MEDIA");
  });
  it("免费听授权失败仍返回播放链接获取失败", async () => {
    mock.enabled = true;
    mock.obtain.mockRejectedValue(new Error("no benefit"));
    expect(await songUrl({ mid: "MID", songId: "456", mediaMid: "MEDIA" })).toMatchObject({
      code: 403,
      data: [{ url: "" }],
    });
  });
});
