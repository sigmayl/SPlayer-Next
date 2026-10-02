import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ request: vi.fn(), uin: "123" }));
vi.mock("../core/request", () => ({
  qmRequest: mock.request,
  getQQMusicUin: () => mock.uin,
  getQQMusicSessionGeneration: () => 0,
}));
import { daily_recommend, album_subscribe, artist_subscribe } from "./account";

beforeEach(() => {
  mock.request.mockReset();
  mock.uin = "123";
});

describe("QQ Lite 账号协议", () => {
  it("每日 30 首使用 Lite 参数并保留双 ID 与毫秒时长", async () => {
    mock.request.mockResolvedValue({
      code: 0,
      dirinfo: { id: 999, title: "每日30首", songnum: 30 },
      songlist: [{ id: 456, mid: "MID", title: "测试", interval: 260, singer: [], album: {} }],
    });
    const result = (await daily_recommend({})) as {
      songs: Array<{ id: string; mid: string; duration: number }>;
    };
    expect(mock.request).toHaveBeenCalledWith(
      "music.qqmusiclite.MtRecommendSvr",
      "GetDaily30",
      expect.objectContaining({ disstid: 0, dirid: 202, song_begin: 0, song_num: 2147483647 }),
      { lite: true },
    );
    expect(result.songs[0]).toMatchObject({ id: "456", mid: "MID", duration: 260000 });
  });
  it("收藏部分失败不能当作成功", async () => {
    mock.request.mockResolvedValue({ result: 0, v_failedAlbumMid: ["MID"] });
    await expect(album_subscribe({ mid: "MID", subscribe: true })).rejects.toThrow();
    expect(mock.request).toHaveBeenCalledWith(
      "music.musicasset.AlbumFavWrite",
      "FavAlbum",
      { v_albumMid: ["MID"] },
      { lite: true, write: true },
    );
  });
  it("歌手 mid 解析到数字 ID，关注与取消的 opertype 不同", async () => {
    mock.request
      .mockResolvedValueOnce({ songList: [{ songInfo: { singer: [{ id: 12345, mid: "MID" }] } }] })
      .mockResolvedValueOnce({ code: 0 });
    await artist_subscribe({ id: "MID", subscribe: true });
    expect(mock.request).toHaveBeenLastCalledWith(
      "Concern.ConcernSystemServer",
      "cgi_concern_user_v2",
      { userinfo: { usertype: 1, userid: "12345" }, opertype: 0, source: 0 },
      { lite: true, write: true },
    );
    mock.request.mockResolvedValue({ code: 0 });
    await artist_subscribe({ id: "12345", subscribe: false });
    expect(mock.request.mock.calls.at(-1)?.[2].opertype).toBe(1);
  });
});
