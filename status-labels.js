const labels = {"zh-CN": {"signing": "签名", "server": "服务器", "version": "版本号", "cli": "CLI", "title": "服务器 / CLI", "source": "源码", "development": "测试服"}, "ar": {"signing": "التوقيع", "server": "الخادم", "version": "إصدار", "cli": "سطر الأوامر", "title": "الخادم / سطر الأوامر", "source": "مصدر", "development": "خادم الاختبار"}, "en": {"signing": "Signing", "server": "Server", "version": "Version", "cli": "CLI", "title": "Server / CLI", "source": "Source", "development": "Test server"}};
export function desktopStatusLabels(language) { return labels[language] ?? labels[language.split("-")[0]] ?? labels.en }
const navigationLabels = {
  "zh-CN": {"pin": "固定侧边栏", "unpin": "收起侧边栏", "pages": "页面导航", "page": "第 {{number}} 页", "overview": "缩略图总览", "campaigns": "探索 Vibémon"},
  "en": {"pin": "Pin sidebar", "unpin": "Collapse sidebar", "pages": "Page navigation", "page": "Page {{number}}", "overview": "Overview", "campaigns": "Explore Vibémon"}
};
/** The main window's chrome names: the sidebar toggle, canvas pagination and overview, and the campaign slot. */
export function desktopNavigationLabels(language) {
  const labels = navigationLabels[language] ?? navigationLabels[language.split("-")[0]] ?? navigationLabels.en
  return { ...labels, page: (number) => labels.page.replace("{{number}}", String(number)) }
}
const settingsLabels = {
  "zh-CN": {"title": "设置", "general": "通用", "appearance": "外观", "about": "关于", "account": "账户", "theme": "主题", "themeLight": "浅色", "themeDark": "深色", "themeSystem": "系统", "language": "语言", "versionLabel": "版本", "engine": "引擎", "codexVersion": "Codex {{version}}", "updates": "更新"},
  "en": {"title": "Settings", "general": "General", "appearance": "Appearance", "about": "About", "account": "Account", "theme": "Theme", "themeLight": "Light", "themeDark": "Dark", "themeSystem": "System", "language": "Language", "versionLabel": "Version", "engine": "Engine", "codexVersion": "Codex {{version}}", "updates": "Updates"}
};
/** U's settings window strings. */
export function desktopSettingsLabels(language) { return settingsLabels[language] ?? settingsLabels[language.split("-")[0]] ?? settingsLabels.en }
const updateLabels = {
  "zh-CN": {"downloading": "正在下载更新 {{percent}}%", "installing": "正在安装更新…完成后将自动重启。", "install": "重新启动以更新", "relaunchTitle": "重新启动以更新?", "relaunchDescription": "应用将关闭并重新启动以应用更新。", "relaunchNow": "立即重启", "relaunchLater": "稍后更新", "checking": "正在检查更新…", "disabled": "自动更新不可用", "disabledDebugBuild": "开发版不检查更新", "upToDate": "已是最新版本", "staging": "正在准备更新…", "ready": "版本 {{version}} 已就绪", "checkNow": "检查更新", "changed": "更新已变化，请确认新版本后再安装。"},
  "en": {"downloading": "Downloading update {{percent}}%", "installing": "Installing update… The app will restart automatically.", "install": "Relaunch to update", "relaunchTitle": "Relaunch to update?", "relaunchDescription": "The app will close and restart to apply the update.", "relaunchNow": "Relaunch now", "relaunchLater": "Update later", "checking": "Checking for updates…", "disabled": "Automatic updates are unavailable", "disabledDebugBuild": "Development builds do not check for updates", "upToDate": "Up to date", "staging": "Preparing update…", "ready": "Version {{version}} is ready", "checkNow": "Check for updates", "changed": "The update changed. Review the new version before installing."}
};
/** The update card, status text and relaunch question; `downloading` keeps `{{percent}}` and `ready` keeps `{{version}}`. */
export function desktopUpdateLabels(language) { return updateLabels[language] ?? updateLabels[language.split("-")[0]] ?? updateLabels.en }
