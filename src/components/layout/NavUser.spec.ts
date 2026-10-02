import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, nextTick, reactive } from "vue";
import { createI18n } from "vue-i18n";
import NavUser from "./NavUser.vue";

const mocks = vi.hoisted(() => ({
  status: { onlinePlatform: "netease" },
  netease: {
    isLoggedIn: true,
    profile: { nickname: "网易用户", avatarUrl: "netease-avatar", vipType: 1, signature: "签名" },
    level: 8,
    subcount: { createdPlaylistCount: 2, subPlaylistCount: 3, artistCount: 7 },
    playlists: [{}],
    albums: [{}],
    artists: [{}],
    fetchStatus: vi.fn(),
    logout: vi.fn(),
  },
  qqmusic: {
    isLoggedIn: true,
    profile: { nickname: "QQ用户", avatarUrl: "qq-avatar", isVip: false },
    playlists: [{}, {}],
    subscribedPlaylists: [{}],
    albums: [{}, {}],
    artists: [{}, {}, {}],
  },
  showSettings: vi.fn(),
  logoutQQMusic: vi.fn(),
  clearProfile: vi.fn(),
  confirm: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/stores/status", () => ({ useStatusStore: () => mocks.status }));
vi.mock("@/stores/user", () => ({ useUserStore: () => mocks.netease }));
vi.mock("@/stores/qqmusic", () => ({ useQQMusicStore: () => mocks.qqmusic }));
vi.mock("@/composables/useOnlineUser", () => ({
  useOnlineUser: () =>
    computed(() => (mocks.status.onlinePlatform === "qqmusic" ? mocks.qqmusic : mocks.netease)),
}));
vi.mock("@/stores/data", () => ({
  useDataStore: () => ({ clearPlatformProfile: mocks.clearProfile }),
}));
vi.mock("@/settings/useSettingsDialog", () => ({
  useSettingsDialog: () => ({ show: mocks.showSettings }),
}));
vi.mock("@/apis/login/qqmusic", () => ({ logoutQQMusic: mocks.logoutQQMusic }));
vi.mock("@/composables/useDialog", () => ({ dialog: { confirm: mocks.confirm } }));
vi.mock("@/composables/useToast", () => ({ toast: { success: vi.fn() } }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: mocks.push }) }));

const mountUser = () =>
  mount(NavUser, {
    global: {
      plugins: [createI18n({ legacy: false, missingWarn: false, fallbackWarn: false })],
      stubs: {
        SPopover: { template: '<div><slot name="trigger"/><slot/></div>' },
        SButton: { template: "<button><slot/></button>" },
        SDivider: true,
        LoginDialog: { props: ["open"], template: '<div data-login :data-open="open" />' },
        IconLucideChevronDown: true,
        IconLucideLogOut: true,
      },
    },
  });

beforeEach(() => {
  mocks.status = reactive({ onlinePlatform: "netease" });
  mocks.netease.isLoggedIn = true;
  mocks.qqmusic.isLoggedIn = true;
  mocks.confirm.mockResolvedValue(true);
});

describe("顶栏的平台账号绑定", () => {
  it("切换平台同步头像、昵称和收藏数，不沿用网易等级和签名", async () => {
    const wrapper = mountUser();
    expect(wrapper.text()).toContain("网易用户");
    expect(wrapper.text()).toContain("Lv.8");
    mocks.status.onlinePlatform = "qqmusic";
    await nextTick();
    expect(wrapper.text()).toContain("QQ用户");
    expect(wrapper.text()).not.toContain("网易用户");
    expect(wrapper.text()).not.toContain("Lv.");
    expect(wrapper.text()).not.toContain("签名");
    expect(wrapper.find("img").attributes("src")).toBe("qq-avatar");
    expect(wrapper.findAll("[title]").map((item) => item.text())).toEqual(["3", "2", "3"]);
    wrapper.unmount();
  });

  it("QQ 未登录时定位设置中的 QQ 账号登录项", async () => {
    mocks.status.onlinePlatform = "qqmusic";
    mocks.qqmusic.isLoggedIn = false;
    const wrapper = mountUser();
    await wrapper.find("button").trigger("click");
    expect(mocks.showSettings).toHaveBeenCalledWith("other", "qmAccount");
    expect(wrapper.find("[data-login]").attributes("data-open")).toBe("false");
    wrapper.unmount();
  });

  it("网易未登录时打开网易登录弹窗，切换平台关闭旧弹窗", async () => {
    mocks.netease.isLoggedIn = false;
    const wrapper = mountUser();
    await wrapper.find("button").trigger("click");
    expect(wrapper.find("[data-login]").attributes("data-open")).toBe("true");
    expect(mocks.showSettings).not.toHaveBeenCalled();
    mocks.status.onlinePlatform = "qqmusic";
    await nextTick();
    expect(wrapper.find("[data-login]").attributes("data-open")).toBe("false");
    wrapper.unmount();
  });

  it("点击收藏数跳转对应收藏页", async () => {
    mocks.status.onlinePlatform = "qqmusic";
    const wrapper = mountUser();
    await wrapper.find('[title="collection.album"]').trigger("click");
    expect(mocks.push).toHaveBeenCalledWith({ path: "/favorites", query: { tab: "album" } });
    wrapper.unmount();
  });

  it.each(["netease", "qqmusic"])("退出 %s 只清理对应账号", async (platform) => {
    mocks.status.onlinePlatform = platform;
    const wrapper = mountUser();
    await wrapper.find("button").trigger("click");
    await flushPromises();
    if (platform === "qqmusic") {
      expect(mocks.logoutQQMusic).toHaveBeenCalledOnce();
      expect(mocks.clearProfile).toHaveBeenCalledWith("qqmusic");
      expect(mocks.netease.logout).not.toHaveBeenCalled();
    } else {
      expect(mocks.netease.logout).toHaveBeenCalledOnce();
      expect(mocks.logoutQQMusic).not.toHaveBeenCalled();
      expect(mocks.clearProfile).not.toHaveBeenCalled();
    }
    wrapper.unmount();
  });
});
