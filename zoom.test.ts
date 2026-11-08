import { expect, mock, test } from "bun:test"

import manifest from "./package.json"

const storage = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key)
  },
  document: { documentElement: { style: new Map<string, string>() } }
})
const style = (globalThis as unknown as { document: { documentElement: { style: Map<string, string> } } }).document
  .documentElement.style
Object.assign(style, { setProperty: (name: string, value: string) => style.set(name, value) })

// Other test files mock the Tauri core as a desktop window; this module runs as a browser page here.
const core = await import("@tauri-apps/api/core")
await mock.module("@tauri-apps/api/core", () => ({ ...core, isTauri: () => false }))
const { clampZoomLevel, readZoomPreference, resetZoom, setZoomLevel, subscribeZoom, ZOOM_LEVELS, zoomIn, zoomLevel, zoomOut } =
  await import("./zoom.js")

test("levels follow U's steps and clamp to the nearest one", () => {
  expect(ZOOM_LEVELS).toEqual([0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2])
  expect(clampZoomLevel(0.7)).toBe(0.67)
  expect(clampZoomLevel(3)).toBe(2)
  expect(clampZoomLevel(0.1)).toBe(0.5)
  expect(() => clampZoomLevel(Number.NaN)).toThrow("finite")
})

test("zooming steps through the levels, saves the preference and corrects native-sized chrome", async () => {
  const changes: number[] = []
  const stop = subscribeZoom(() => changes.push(zoomLevel()))
  await zoomIn()
  await zoomIn()
  expect(zoomLevel()).toBe(1.25)
  expect(style.get("--window-zoom-correction")).toBe(String(1 / 1.25))
  expect(readZoomPreference()).toBe(1.25)
  await zoomOut()
  expect(zoomLevel()).toBe(1.1)
  await setZoomLevel(9)
  expect(zoomLevel()).toBe(2)
  await zoomIn()
  expect(zoomLevel()).toBe(2)
  await resetZoom()
  expect(zoomLevel()).toBe(1)
  expect(storage.has("alwith-desktop-shell.zoom")).toBe(false)
  expect(changes).toEqual([1.1, 1.25, 1.1, 2, 2, 1])
  stop()
})

test("the zoom module and feedback are published", () => {
  for (const file of ["zoom.js", "zoom.d.ts", "zoom-feedback.js", "zoom-feedback.d.ts"]) expect(manifest.files).toContain(file)
  expect(manifest.exports["./zoom"]).toEqual({ types: "./zoom.d.ts", import: "./zoom.js" })
})
