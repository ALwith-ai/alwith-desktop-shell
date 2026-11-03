/** Generator-owned defaults. Product identity remains in alwith.app.json. */
export function desktopWindow(app) {
  return {
    label: "main",
    title: app.productName,
    width: app.window.width,
    height: app.window.height,
    minWidth: app.window.minWidth,
    minHeight: app.window.minHeight,
    transparent: true,
    decorations: true,
    titleBarStyle: "Overlay",
    hiddenTitle: true
  }
}
