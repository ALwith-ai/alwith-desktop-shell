import { expect, test } from "bun:test"

import type { DesktopUpdaterState } from "./native.js"
import { desktopUpdateLabels } from "./status-labels.js"
import { createDesktopUpdater, type DesktopUpdaterIo, desktopUpdateStatusText } from "./updates.js"

const update = (version: string, signature = `sig-${version}`) => ({
  version,
  filename: `app-${version}.app.tar.gz`,
  signature,
  contentLength: null
})
const ready = (version: string, signature?: string): DesktopUpdaterState => ({
  type: "ready",
  update: update(version, signature)
})

function fakeIo(initial: DesktopUpdaterState = { type: "idle" }) {
  let handler: ((state: DesktopUpdaterState) => void) | null = null
  const calls = { install: [] as unknown[], confirm: 0, getState: 0 }
  let confirmAnswer = true
  let installError: Error | null = null
  let onGetState: (() => void) | null = null
  const io: DesktopUpdaterIo = {
    listen: async (next) => {
      handler = next
      return () => {
        handler = null
      }
    },
    getState: async () => {
      calls.getState++
      onGetState?.()
      return initial
    },
    check: async () => initial,
    install: async (expected) => {
      calls.install.push(expected)
      if (installError) throw installError
    },
    confirm: async () => {
      calls.confirm++
      return confirmAnswer
    }
  }
  return {
    io,
    calls,
    emit: (state: DesktopUpdaterState) => handler?.(state),
    answer: (value: boolean) => {
      confirmAnswer = value
    },
    failInstall: (error: Error | null) => {
      installError = error
    },
    duringGetState: (fn: () => void) => {
      onGetState = fn
    }
  }
}

test("listens before reading the state so an event during the read wins", async () => {
  const fake = fakeIo({ type: "idle" })
  const updater = createDesktopUpdater(fake.io)
  fake.duringGetState(() => fake.emit(ready("1.1.0")))
  await updater.start()
  expect(updater.getSnapshot().state).toEqual(ready("1.1.0"))
})

test("prepare runs before install, the release is re-checked and finishPreparation always follows", async () => {
  const fake = fakeIo(ready("1.1.0"))
  const updater = createDesktopUpdater(fake.io)
  const order: string[] = []
  updater.configure({
    prepare: async () => {
      order.push("prepare")
    },
    finishPreparation: (installed) => order.push(`finish:${installed}`)
  })
  await updater.start()
  expect(await updater.install()).toBe(true)
  expect(order).toEqual(["prepare", "finish:true"])
  expect(fake.calls.install).toEqual([{ version: "1.1.0", signature: "sig-1.1.0" }])
})

test("a release replaced during preparation is not installed and the error is surfaced", async () => {
  const fake = fakeIo(ready("1.1.0"))
  const updater = createDesktopUpdater(fake.io)
  const finished: boolean[] = []
  updater.configure({
    prepare: async () => fake.emit(ready("1.1.0", "resigned")),
    finishPreparation: (installed) => finished.push(installed)
  })
  await updater.start()
  expect(await updater.install()).toBe(false)
  expect(fake.calls.install).toEqual([])
  expect(updater.getSnapshot().error).toBe(desktopUpdateLabels("en").changed)
  expect(updater.getSnapshot().busy).toBe(false)
  expect(finished).toEqual([false])
})

test("install and preparation failures become the error; dismiss clears it", async () => {
  const fake = fakeIo(ready("1.1.0"))
  const updater = createDesktopUpdater(fake.io)
  await updater.start()
  fake.failInstall(new Error("swap failed"))
  expect(await updater.install()).toBe(false)
  expect(updater.getSnapshot().error).toBe("swap failed")
  updater.configure({ prepare: async () => Promise.reject(new Error("unsaved work")) })
  expect(await updater.install()).toBe(false)
  expect(updater.getSnapshot().error).toBe("unsaved work")
  updater.dismiss()
  expect(updater.getSnapshot().error).toBeNull()
})

test("auto prompt asks once per ready version with the native dialog", async () => {
  const fake = fakeIo({ type: "idle" })
  const updater = createDesktopUpdater(fake.io)
  fake.answer(false)
  await updater.start(true)
  fake.emit(ready("1.1.0"))
  fake.emit({ type: "idle" })
  fake.emit(ready("1.1.0"))
  await Bun.sleep(0)
  expect(fake.calls.confirm).toBe(1)
  fake.answer(true)
  fake.emit(ready("1.2.0"))
  await Bun.sleep(0)
  expect(fake.calls.confirm).toBe(2)
  expect(fake.calls.install).toEqual([{ version: "1.2.0", signature: "sig-1.2.0" }])
})

test("a custom dialog gets prompt instead of the native question", async () => {
  const fake = fakeIo({ type: "idle" })
  const updater = createDesktopUpdater(fake.io)
  updater.configure({ dialog: "custom" })
  await updater.start(true)
  fake.emit(ready("1.1.0"))
  await Bun.sleep(0)
  expect(fake.calls.confirm).toBe(0)
  expect(updater.getSnapshot().prompt).toBe(true)
  updater.dismiss()
  expect(updater.getSnapshot().prompt).toBe(false)
  await updater.requestInstall()
  expect(updater.getSnapshot().prompt).toBe(true)
  fake.emit({ type: "idle" })
  expect(updater.getSnapshot().prompt).toBe(false)
})

test("onStateChange sees every state with the previous one", async () => {
  const fake = fakeIo({ type: "idle" })
  const updater = createDesktopUpdater(fake.io)
  const seen: string[] = []
  updater.configure({ onStateChange: (state, previous) => seen.push(`${previous.type}>${state.type}`) })
  await updater.start()
  fake.emit({ type: "downloading", update: update("1.1.0"), downloadedBytes: 1, totalBytes: 2 })
  fake.emit(ready("1.1.0"))
  expect(seen).toEqual(["uninitialized>idle", "idle>downloading", "downloading>ready"])
})

test("status text covers every state", () => {
  const labels = desktopUpdateLabels("en")
  expect(desktopUpdateStatusText({ type: "checkingForUpdates" }, labels)).toBe(labels.checking)
  expect(desktopUpdateStatusText({ type: "disabled", reason: "debugBuild" }, labels)).toBe(
    "Development builds do not check for updates"
  )
  expect(desktopUpdateStatusText({ type: "disabled", reason: "invalidConfiguration" }, labels)).toBe(labels.disabled)
  const { disabledDebugBuild: _, ...partial } = labels
  expect(desktopUpdateStatusText({ type: "disabled", reason: "debugBuild" }, partial)).toBe(labels.disabled)
  expect(desktopUpdateStatusText({ type: "idle" }, labels)).toBe(labels.upToDate)
  expect(desktopUpdateStatusText({ type: "staging", update: update("1.1.0") }, labels)).toBe(labels.staging)
  expect(desktopUpdateStatusText(ready("1.1.0"), labels)).toBe("Version 1.1.0 is ready")
  expect(
    desktopUpdateStatusText({ type: "downloading", update: update("1.1.0"), downloadedBytes: 1, totalBytes: 4 }, labels)
  ).toBe("Downloading update 25%")
  expect(desktopUpdateLabels("zh-CN").staging).toBe("正在准备更新…")
})
