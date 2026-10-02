import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  enabled: false,
  obtain: vi.fn(),
  request: vi.fn(),
  fetch: vi.fn(),
  refresh: vi.fn(),
  cookies: {} as Record<string, string>,
  order: [] as string[],
}));
vi.mock("@main/store", () => ({ store: { get: () => mock.enabled } }));
vi.mock("@main/services/qqmusicFreeMode", () => ({ obtainFreeModeUrl: mock.obtain }));
vi.mock("../core/request", () => ({
  qmRequest: mock.request,
  getQQMusicCookies: () => mock.cookies,
  getQQMusicUin: () => "123",
  refreshQMCredential: mock.refresh,
}));
vi.mock("@main/utils/logger", () => ({
  coreLog: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
import songUrl from "./song_url";

beforeEach(() => {
  mock.enabled = false;
  mock.cookies = {};
  mock.order = [];
  mock.refresh.mockReset().mockResolvedValue(true);
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
  it("登录免费用户拿不到 VIP 直链时先走免费听，成功后不刷新凭据", async () => {
    mock.enabled = true;
    mock.cookies = { qm_keyst: "credential" };
    expect(await songUrl({ mid: "MID", songId: "456", mediaMid: "MEDIA" })).toMatchObject({
      code: 200,
      data: [{ freeMode: true }],
    });
    expect(mock.fetch).toHaveBeenCalledOnce();
    expect(mock.obtain).toHaveBeenCalledOnce();
    expect(mock.refresh).not.toHaveBeenCalled();
  });

  it("直链与免费听都失败后刷新一次，并按直链、免费听的顺序重试", async () => {
    mock.enabled = true;
    mock.cookies = { qm_keyst: "credential" };
    mock.fetch.mockImplementation(async () => {
      mock.order.push("direct");
      return { json: async () => ({ code: 0, req_0: { code: 0, data: {} } }) };
    });
    mock.obtain.mockImplementation(async () => {
      mock.order.push("free");
      if (mock.order.length < 5) throw new Error("no url");
      return "https://test/free";
    });
    mock.refresh.mockImplementation(async () => {
      mock.order.push("refresh");
      return true;
    });
    expect(await songUrl({ mid: "MID", songId: "456", mediaMid: "MEDIA" })).toMatchObject({
      code: 200,
      data: [{ freeMode: true }],
    });
    expect(mock.order).toEqual(["direct", "free", "refresh", "direct", "free"]);
    expect(mock.refresh).toHaveBeenCalledOnce();
  });

  it("刷新后直链成功就结束，不再请求免费听", async () => {
    mock.enabled = true;
    mock.cookies = { qm_keyst: "credential" };
    mock.obtain.mockRejectedValue(new Error("no url"));
    mock.fetch.mockResolvedValueOnce({
      json: async () => ({ code: 0, req_0: { code: 0, data: {} } }),
    });
    mock.fetch.mockResolvedValueOnce({
      json: async () => ({
        code: 0,
        req_0: {
          code: 0,
          data: {
            sip: ["https://test/"],
            midurlinfo: [{ filename: "M800MEDIA.mp3", purl: "normal" }],
          },
        },
      }),
    });
    expect(await songUrl({ mid: "MID", songId: "456", mediaMid: "MEDIA" })).toMatchObject({
      code: 200,
      data: [{ url: "https://test/normal" }],
    });
    expect(mock.refresh).toHaveBeenCalledOnce();
    expect(mock.obtain).toHaveBeenCalledOnce();
  });

  it.each([false, "error"])("凭据刷新失败时停止重试：%s", async (result) => {
    mock.enabled = true;
    mock.cookies = { qm_keyst: "credential" };
    mock.obtain.mockRejectedValue(new Error("no url"));
    if (result === false) mock.refresh.mockResolvedValue(false);
    else mock.refresh.mockRejectedValue(new Error("refresh failed"));
    expect(await songUrl({ mid: "MID", songId: "456", mediaMid: "MEDIA" })).toMatchObject({
      code: 403,
    });
    expect(mock.refresh).toHaveBeenCalledOnce();
    expect(mock.fetch).toHaveBeenCalledOnce();
    expect(mock.obtain).toHaveBeenCalledOnce();
  });

  it("免费听关闭时仍保留直链失败后的凭据刷新重试", async () => {
    mock.cookies = { qm_keyst: "credential" };
    expect(await songUrl({ mid: "MID" })).toMatchObject({ code: 403 });
    expect(mock.refresh).toHaveBeenCalledOnce();
    expect(mock.fetch).toHaveBeenCalledTimes(2);
    expect(mock.obtain).not.toHaveBeenCalled();
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
