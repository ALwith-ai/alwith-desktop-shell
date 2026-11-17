import { afterAll, beforeAll, expect, mock, test } from "bun:test"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

const canvasOptions: Array<{ insetTop?: number }> = []
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator")

beforeAll(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { language: "en", platform: "Win32" }
  })
})

afterAll(() => {
  if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor)
  else Reflect.deleteProperty(globalThis, "navigator")
})

// Assert the shell-to-Atlas contract without starting a native window or a layout engine.
mock.module("@nyssance/atlas/react", () => ({
  useAtlas(options: { insetTop?: number }): { ref: (node: HTMLElement | null) => void; atlas: null } {
    canvasOptions.push(options)
    return { ref: () => {}, atlas: null }
  }
}))

const { DesktopTitleBarContext, DesktopWorkspace } = await import("./workspace.js")

test.each([
  { external: false, expected: 32 },
  { external: true, expected: 0 }
])("the canvas reserves top space only for its own titlebar: external=$external", ({ external, expected }) => {
  canvasOptions.length = 0
  // The context carries a portal destination; this leading-screen render never portals into it.
  const target = external ? ({} as HTMLElement) : null
  const html = renderToStaticMarkup(
    createElement(
      DesktopTitleBarContext.Provider,
      { value: target },
      createElement(DesktopWorkspace, {
        navigation: null,
        leading: createElement("main", null, "Extensions"),
        panes: [{ id: "chat", title: "Chat", children: null }],
        screen: "leading",
        statusBar: null,
        trackpad: false
      })
    )
  )
  expect(canvasOptions).toHaveLength(1)
  expect(canvasOptions[0]?.insetTop).toBe(expected)
  expect(html).toContain("Extensions")
})
