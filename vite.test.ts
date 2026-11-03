import { expect, test } from "bun:test"

import { bootLoaderHtml, desktopShellPages } from "./vite.js"

const page = '<!doctype html><html><head><title>App</title></head><body><div id="root"></div></body></html>'

test("the main entry gets the stroked wordmark inside #root", () => {
  const html = desktopShellPages().transformIndexHtml.handler(page, { filename: "/app/index.html" })
  expect(html).toContain('<div id="root"><div class="__boot-loader"')
  expect(html).toContain("@keyframes __boot-draw")
  expect(html).toContain("\u039bLwith")
  expect(html).toMatch(/\.__boot-loader \{\n[^}]*visibility: visible/)
})

test("other entries get only the theme, and a filled root keeps its content", () => {
  const settings = desktopShellPages().transformIndexHtml.handler(page, { filename: "/app/settings.html" })
  expect(settings).not.toContain("__boot-loader")
  expect(settings).toContain("alwith-desktop-shell.theme")
  const filled = page.replace('<div id="root"></div>', '<div id="root"><p>x</p></div>')
  expect(bootLoaderHtml(filled)).toBe(filled)
})
