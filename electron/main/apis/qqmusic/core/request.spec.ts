import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  fetch: vi.fn(),
  cookies: { qm_str_musicid: "123", qm_keyst: "TOKEN" },
}));
vi.mock("@main/database/sessions", () => ({
  getSessionCookies: () => mock.cookies,
  saveSessionCookies: vi.fn(),
  clearSessionCookies: vi.fn(),
}));
vi.mock("@main/utils/logger", () => ({ coreLog: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("@main/utils/proxy", () => ({
  fetchWithProxy: mock.fetch,
  getNetworkProxyUrl: () => null,
}));
import { qmRequest, mergeQQMusicCookies } from "./request";
const response = (data: unknown) => ({ ok: true, json: async () => data });
beforeEach(() => {
  mock.fetch.mockReset();
  vi.stubGlobal("fetch", mock.fetch);
  mergeQQMusicCookies(mock.cookies);
});

describe("QQ 请求账号安全与写入语义", () => {
  it("Lite 信封沿用认证 comm，使用 mz 入口", async () => {
    mock.fetch.mockResolvedValue(response({ code: 0, request: { code: 0, data: { ok: true } } }));
    await qmRequest("M", "Get", {}, { lite: true, session: false });
    const [url, options] = mock.fetch.mock.calls[0];
    expect(url).toBe("https://mz.y.qq.com/cgi-bin/musicu.fcg");
    expect(JSON.parse(options.body).comm).toMatchObject({
      qq: "123",
      authst: "TOKEN",
      tmeAppID: "qqmusic",
    });
  });
  it("写请求网络失败不重复提交", async () => {
    mock.fetch.mockRejectedValue(new Error("断网"));
    await expect(qmRequest("M", "Write", {}, { session: false, write: true })).rejects.toThrow(
      "断网",
    );
    expect(mock.fetch).toHaveBeenCalledTimes(1);
  });
  it("账号切换后旧回包不返回给新账号", async () => {
    let resolve!: (value: unknown) => void;
    mock.fetch.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const request = qmRequest("M", "Get", {}, { session: false });
    mergeQQMusicCookies({ qm_str_musicid: "456" });
    resolve(response({ code: 0, request: { code: 0, data: { secret: "旧账号内容" } } }));
    await expect(request).rejects.toThrow("账号会话已变化");
    expect(mock.fetch).toHaveBeenCalledTimes(1);
  });
  it("缺少业务信封不能被当成成功", async () => {
    mock.fetch.mockResolvedValue(response({ code: 0 }));
    await expect(qmRequest("M", "Write", {}, { session: false, write: true })).rejects.toThrow(
      "QM API 错误",
    );
  });
});
