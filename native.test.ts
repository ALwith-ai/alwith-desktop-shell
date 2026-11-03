import { expect, mock, test } from "bun:test"

import type { WebviewWindow } from "@tauri-apps/api/webviewWindow"

type WebviewWindowOptions = NonNullable<ConstructorParameters<typeof WebviewWindow>[1]>

let current: Window | null = null
let created = 0
let fail = false
let lastOptions: WebviewWindowOptions = {}
const log: string[] = []
const emitted: [string, string, unknown][] = []
function register(window: Window) {
  current = window
}
function currentWindow() {
  if (!current) throw new Error("No settings window was created")
  return current
}
class Window {
  handlers = new Map<string, (event: { payload: string }) => void>()
  show = mock(() => {
    log.push("show")
    return Promise.resolve()
  })
  setFocus = mock(() => {
    log.push("focus")
    return Promise.resolve()
  })
  close = mock(() => Promise.resolve())
  static getByLabel() {
    return Promise.resolve(current)
  }
  constructor(label: string, options: WebviewWindowOptions) {
    expect(label).toBe("settings")
    lastOptions = options
    created++
    queueMicrotask(() => {
      if (!fail) register(this)
      this.handlers.get(fail ? "tauri://error" : "tauri://created")?.({ payload: "creation failed" })
    })
  }
  once(name: string, handler: (event: { payload: string }) => void) {
    this.handlers.set(name, handler)
    return Promise.resolve(() => this.handlers.delete(name))
  }
}
// Keep the real exports for modules that import core alongside native.js (settings.js's app API).
const core = await import("@tauri-apps/api/core")
await mock.module("@tauri-apps/api/core", () => ({ ...core, isTauri: () => true, invoke: () => Promise.resolve({}) }))
await mock.module("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: Window,
  getCurrentWebviewWindow: () => current
}))
const event = await import("@tauri-apps/api/event")
await mock.module("@tauri-apps/api/event", () => ({
  ...event,
  emitTo: (target: string, event: string, payload: unknown) => {
    emitted.push([target, event, payload])
    return Promise.resolve()
  }
}))
const { openDesktopSettings } = await import("./native.js")
test("concurrent settings requests create one window and later requests focus it", async () => {
  await Promise.all([openDesktopSettings(), openDesktopSettings()])
  expect(created).toBe(1)
  expect(lastOptions.url).toBe("/settings.html")
  expect("backgroundColor" in lastOptions).toBe(false)
  await openDesktopSettings()
  expect(created).toBe(1)
  expect(currentWindow().show).toHaveBeenCalledTimes(2)
  expect(currentWindow().setFocus).toHaveBeenCalledTimes(2)
})
test("creation errors propagate without another creation attempt", async () => {
  current = null
  fail = true
  const before = created
  await expect(openDesktopSettings()).rejects.toThrow("creation failed")
  expect(created).toBe(before + 1)
})
test("a new window takes the default section and background color; attach runs before show and focus", async () => {
  current = null
  fail = false
  log.length = 0
  const attach = (label: string) => {
    log.push(`attach:${label}`)
    return Promise.resolve()
  }
  await openDesktopSettings("Settings", undefined, { defaultSection: "general", backgroundColor: [1, 2, 3], attach })
  expect(lastOptions.url).toBe("/settings.html?tab=general")
  expect(lastOptions.backgroundColor).toEqual([1, 2, 3])
  expect(log).toEqual(["attach:settings", "show", "focus"])
  current = null
  log.length = 0
  await openDesktopSettings("Settings", "extensions", { defaultSection: "general", attach })
  expect(lastOptions.url).toBe("/settings.html?tab=extensions")
})
test("an existing window is attached before it is shown, then switched to the section", async () => {
  log.length = 0
  emitted.length = 0
  const before = created
  const attach = (label: string) => {
    log.push(`attach:${label}`)
    return Promise.resolve()
  }
  await openDesktopSettings("Settings", "about", { attach })
  expect(created).toBe(before)
  expect(log).toEqual(["attach:settings", "show", "focus"])
  expect(emitted).toEqual([["settings", "settings-change-tab", "about"]])
})
test("a failed attach propagates and the window is not shown", async () => {
  log.length = 0
  await expect(
    openDesktopSettings("Settings", undefined, {
      attach: () => Promise.reject(new Error("attach failed"))
    })
  ).rejects.toThrow("attach failed")
  expect(log).toEqual([])
})
