import { expect, mock, test } from "bun:test"

import * as React from "react"

import type { SettingsSectionItem } from "./settings.js"

// A one-component hook runner: no DOM is needed to follow the section events.
const state: unknown[] = []
let slot = 0
const effects: (() => void | (() => void))[] = []
await mock.module("react", () => ({
  ...React,
  useState: (initial: unknown) => {
    const index = slot++
    if (!(index in state)) state[index] = typeof initial === "function" ? (initial as () => unknown)() : initial
    return [
      state[index],
      (next: unknown) => {
        state[index] = next
      }
    ]
  },
  useRef: (initial: unknown) => {
    const index = slot++
    if (!(index in state)) state[index] = { current: initial }
    return state[index]
  },
  useEffect: (effect: () => void | (() => void)) => {
    effects.push(effect)
  }
}))
let send: ((section: string) => void) | undefined
// The real native.js listens through these; mocking them (not native.js) keeps other test files unaffected.
const core = await import("@tauri-apps/api/core")
await mock.module("@tauri-apps/api/core", () => ({ ...core, isTauri: () => true }))
const event = await import("@tauri-apps/api/event")
await mock.module("@tauri-apps/api/event", () => ({
  ...event,
  listen: (_event: string, handler: (event: { payload: unknown }) => void) => {
    send = (section) => handler({ payload: section })
    return Promise.resolve(() => {
      send = undefined
    })
  }
}))
Object.assign(globalThis, { window: { location: { search: "?tab=about" } } })
// Run outside React on purpose: the mocked hooks above stand in for a component render.
const { useSettingsSection: runSettingsSection } = await import("./settings.js")
const sections: SettingsSectionItem[] = [
  { id: "general", label: "General", icon: () => null },
  { id: "about", label: "About", icon: () => null }
]

test("onChange runs on every section switch from the main window, with the latest callback", async () => {
  const changes: string[] = []
  const render = (label: string) => {
    slot = 0
    return runSettingsSection(sections, "general", (id: string) => changes.push(`${label}:${id}`))
  }
  const [initial] = render("first")
  expect(initial).toBe("about")
  const cleanup = effects[0]?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  send?.("general")
  send?.("unknown")
  render("second")
  send?.("general")
  expect(changes).toEqual(["first:general", "second:general"])
  const [section, setSection] = render("second")
  expect(section).toBe("general")
  setSection("about")
  expect(changes).toHaveLength(2)
  cleanup?.()
  expect(send).toBeUndefined()
})
