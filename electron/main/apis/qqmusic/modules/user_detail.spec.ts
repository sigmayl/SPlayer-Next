import { expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ request: vi.fn(), clear: vi.fn() }));
vi.mock("../core/request", () => ({
  qmRequest: mock.request,
  getQQMusicUin: () => "123",
  getQQMusicCookies: () => ({ qm_keyst: "TOKEN" }),
  clearQQMusicCookies: mock.clear,
}));
vi.mock("@main/utils/logger", () => ({ coreLog: { warn: vi.fn() } }));
import userDetail from "./user_detail";
it("网络故障不能删除登录凭据或伪装成已退出", async () => {
  mock.request.mockRejectedValue(new Error("断网"));
  await expect(userDetail({})).rejects.toThrow("暂时无法验证");
  expect(mock.clear).not.toHaveBeenCalled();
});
