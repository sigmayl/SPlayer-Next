import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ request: vi.fn(), songList: vi.fn(), generation: 0 }));
vi.mock("./song_list", () => ({ default: mock.songList }));
vi.mock("../core/request", () => ({
  qmRequest: mock.request,
  getQQMusicUin: () => "123",
  getQQMusicCookies: () => ({ euin: "E" }),
  getQQMusicSessionGeneration: () => mock.generation,
}));
import { playlist_delete, playlist_tracks, playlist_update } from "./library";
const owned = {
  v_playlist: [
    { tid: 999, dirId: 4, dirName: "测试", songNum: 0 },
    { tid: 888, dirId: 201, dirName: "我喜欢", songNum: 1 },
  ],
};
beforeEach(() => {
  mock.request.mockReset();
  mock.generation = 0;
  mock.songList.mockReset().mockResolvedValue({ songs: [], total: 0 });
});

describe("QQ 歌单写入", () => {
  it("目录 ID 从账号列表解析，编辑掩码只修改名称与描述", async () => {
    mock.request.mockResolvedValueOnce(owned).mockResolvedValueOnce({ retCode: 0 });
    await playlist_update({ id: "999", name: "新名称", description: "描述" });
    expect(mock.request).toHaveBeenLastCalledWith(
      "music.musicasset.PlaylistBaseWrite",
      "EditPlaylist",
      { dirId: 4, mask: 3, dirNewName: "新名称", dirNewDesc: "描述" },
      { write: true },
    );
  });
  it("不允许删除我喜欢或其他用户歌单", async () => {
    mock.request.mockResolvedValue(owned);
    await expect(playlist_delete({ id: "888" })).rejects.toThrow("不可管理");
    await expect(playlist_delete({ id: "777" })).rejects.toThrow("不可管理");
    expect(mock.request.mock.calls.every((call) => call[1] === "GetPlaylistByUin")).toBe(true);
  });
  it("中途切换账号不使用旧目录向新账号写入", async () => {
    mock.request.mockResolvedValueOnce(owned).mockImplementationOnce(async () => {
      mock.generation++;
      return { track_info: { id: 456 } };
    });
    await expect(playlist_tracks({ id: "999", ids: ["MID"], add: true })).rejects.toThrow(
      "账号会话已变化",
    );
    expect(mock.request).toHaveBeenCalledTimes(2);
  });
  it("加歌使用数字 ID 并提前排除重复歌曲", async () => {
    mock.request
      .mockResolvedValueOnce(owned)
      .mockResolvedValueOnce({ track_info: { id: 456 } })
      .mockResolvedValueOnce({ retCode: 0 });
    const result = (await playlist_tracks({ id: "999", ids: ["MID", "MID"], add: true })) as {
      count: number;
    };
    expect(result.count).toBe(1);
    expect(mock.request.mock.calls.at(-1)?.[2]).toMatchObject({
      dirId: 4,
      tid: 999,
      v_songInfo: [{ songId: 456, songType: 0 }],
    });
    mock.request.mockReset().mockResolvedValue(owned);
    mock.songList.mockResolvedValue({ songs: [{ mid: "MID" }], total: 1 });
    const duplicate = (await playlist_tracks({ id: "999", ids: ["MID"], add: true })) as {
      count: number;
    };
    expect(duplicate.count).toBe(0);
    expect(mock.request).toHaveBeenCalledTimes(1);
  });
});
