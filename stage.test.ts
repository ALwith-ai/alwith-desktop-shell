import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"

import { stageNativeModule } from "./stage.js"

const temporary: string[] = []
afterEach(() => {
  for (const p of temporary.splice(0)) rmSync(p, { recursive: true, force: true })
})
const triples: Record<string, [string, string]> = {
  "darwin-arm64": ["aarch64-apple-darwin", ".dylib"],
  "win32-x64": ["x86_64-pc-windows-msvc", ".dll"],
  "linux-x64": ["x86_64-unknown-linux-gnu", ".so"]
}
const sha = (text: string) => createHash("sha256").update(text).digest("hex")
const CONTRACT = 3

/** Write one platform directory in the layout alwith-modules publishes (scripts/lib/native-artifact.ts). */
function platformDirectory(directory: string, module: string, platform: string) {
  const [target, extension] = triples[platform]!
  mkdirSync(join(directory, "licenses/dep-1.0.0"), { recursive: true })
  const binary = `${platform.startsWith("win32") ? "" : "lib"}alwith_native_${module.replaceAll("-", "_")}${extension}`
  writeFileSync(join(directory, binary), "fixture binary, never executed")
  const helper =
    module === "device" && platform === "darwin-arm64"
      ? { binary: "alwith-device-helper", sha256: sha("fixture helper"), revision: "a".repeat(40) }
      : undefined
  if (helper) writeFileSync(join(directory, helper.binary), "fixture helper")
  const pin = { module, contract: CONTRACT, abi: 1, target, binary, sha256: sha("fixture binary, never executed"), helper }
  writeFileSync(join(directory, "artifact.json"), JSON.stringify(pin))
  writeFileSync(join(directory, "THIRD_PARTY_NOTICES.md"), "fixture notices")
  writeFileSync(join(directory, "licenses/dep-1.0.0/LICENSE"), "fixture dependency licence")
  return pin
}

/** An application with a fake installed `@alwith/module-<module>` carrying the given platforms. */
function fixture(module = "editor", platforms = ["darwin-arm64", "win32-x64"]) {
  const root = mkdtempSync(join(tmpdir(), "desktop-shell-stage-"))
  temporary.push(root)
  const pkg = join(root, `node_modules/@alwith/module-${module}`)
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: `@alwith/module-${module}`, version: "0.5.0" }))
  writeFileSync(join(pkg, "LICENSE"), "fixture license")
  const pins = Object.fromEntries(
    platforms.map((platform) => [platform, platformDirectory(join(pkg, "native", platform), module, platform)])
  )
  const from = pathToFileURL(join(root, "scripts/stage.ts")).href
  return {
    root,
    pkg,
    pins,
    platform: (platform: string) => join(pkg, "native", platform),
    stage: (platform = platforms[0]!, expected?: number) =>
      stageNativeModule(from, module, triples[platform]![0], join(root, "output"), join(root, "legal"), expected)
  }
}

for (const [module, platforms] of [
  ["editor", ["darwin-arm64", "win32-x64"]],
  ["chat-network", ["darwin-arm64", "win32-x64"]],
  ["device", ["darwin-arm64", "win32-x64"]],
  ["computer", ["darwin-arm64", "win32-x64", "linux-x64"]]
] as const)
  for (const platform of platforms)
    test(`${module} stages ${platform} with signing classes`, () => {
      const f = fixture(module, [...platforms])
      const staged = f.stage(platform, CONTRACT)
      const signed = staged.filter((file) => file.signing === "resign")
      expect(signed.map((file) => relative(f.root, file.path)).toSorted()).toEqual(
        [
          `output/${f.pins[platform]!.binary}`,
          ...(f.pins[platform]!.helper ? ["output/alwith-device-helper"] : [])
        ].toSorted()
      )
      expect(readFileSync(join(f.root, "output", f.pins[platform]!.binary), "utf8")).toBe(
        "fixture binary, never executed"
      )
      expect(
        staged
          .filter((file) => file.signing === "resource")
          .map((file) => relative(f.root, file.path))
          .toSorted()
      ).toEqual(
        [
          `legal/alwith-native-${module}/LICENSE`,
          `legal/alwith-native-${module}/THIRD_PARTY_NOTICES.md`,
          `legal/alwith-native-${module}/licenses/dep-1.0.0/LICENSE`
        ].toSorted()
      )
      expect(staged.length).toBe(signed.length + 3)
    })

test("the contract is optional and any positive generation is accepted without one", () => {
  const f = fixture()
  expect(f.stage().some((file) => file.signing === "resign")).toBe(true)
})

test("rejects corrupt bytes and foreign module/contract/target/ABI/path identities", () => {
  const f = fixture()
  const pin = f.pins["darwin-arm64"]!
  const artifact = join(f.platform("darwin-arm64"), "artifact.json")
  for (const patch of [
    { module: "fs" },
    { contract: 0 },
    { contract: 1.5 },
    { contract: "3" },
    { target: "x86_64-unknown-linux-gnu" },
    { abi: 2 },
    { binary: "../outside" },
    { binary: "alwith_native_editor.dylib" }
  ]) {
    writeFileSync(artifact, JSON.stringify({ ...pin, ...patch }))
    expect(() => f.stage()).toThrow("identity mismatch")
  }
  writeFileSync(artifact, JSON.stringify(pin))
  expect(() => f.stage("darwin-arm64", CONTRACT + 1)).toThrow("identity mismatch")
  writeFileSync(join(f.platform("darwin-arm64"), pin.binary), "corrupt")
  expect(() => f.stage()).toThrow("checksum mismatch")
})

test("rejects a foreign package, a missing package and a platform the package does not carry", () => {
  const f = fixture("editor", ["darwin-arm64"])
  expect(() => f.stage("win32-x64")).toThrow("has no native library for x86_64-pc-windows-msvc")
  writeFileSync(join(f.pkg, "package.json"), JSON.stringify({ name: "@alwith/native-editor", version: "0.5.0" }))
  expect(() => f.stage()).toThrow("identity mismatch")
  rmSync(f.pkg, { recursive: true })
  expect(() => f.stage()).toThrow("Missing @alwith/module-editor")
})

test("rejects unsupported targets and invalid module identities before resolving any package", () => {
  for (const target of ["aarch64-pc-windows-msvc", "aarch64-unknown-linux-gnu", "x86_64-apple-darwin"])
    expect(() => stageNativeModule(import.meta.url, "auth", target, "/unused", "/unused")).toThrow(
      "Unsupported native target"
    )
  expect(() => stageNativeModule(import.meta.url, "auth", "x86_64-unknown-linux-gnu", "/unused", "/unused")).toThrow(
    "Unsupported native target"
  )
  for (const module of ["Editor", "../editor", "editor-", ""])
    expect(() => stageNativeModule(import.meta.url, module, "aarch64-apple-darwin", "/unused", "/unused")).toThrow(
      "Invalid native module identity"
    )
})

test("device helper is staged executable; checksum, identity and absence are rejected", () => {
  const f = fixture("device")
  f.stage()
  const helper = join(f.root, "output/alwith-device-helper")
  expect(readFileSync(helper, "utf8")).toBe("fixture helper")
  if (process.platform !== "win32") expect(statSync(helper).mode & 0o111).toBe(0o111)
  const directory = f.platform("darwin-arm64")
  const pin = f.pins["darwin-arm64"]!
  for (const patch of [{ binary: "helper" }, { revision: "main" }]) {
    writeFileSync(join(directory, "artifact.json"), JSON.stringify({ ...pin, helper: { ...pin.helper!, ...patch } }))
    expect(() => f.stage()).toThrow("Invalid device helper identity")
  }
  writeFileSync(join(directory, "artifact.json"), JSON.stringify(pin))
  writeFileSync(join(directory, "alwith-device-helper"), "tampered")
  expect(() => f.stage()).toThrow("helper checksum mismatch")
  writeFileSync(join(directory, "artifact.json"), JSON.stringify({ ...pin, helper: undefined }))
  rmSync(join(directory, "alwith-device-helper"))
  expect(() => f.stage()).toThrow("Device helper is missing")
})

test("a helper on any other module or platform is rejected", () => {
  const f = fixture("editor")
  const pin = f.pins["darwin-arm64"]!
  const helper = { binary: "alwith-device-helper", sha256: sha("fixture helper"), revision: "a".repeat(40) }
  writeFileSync(join(f.platform("darwin-arm64"), "artifact.json"), JSON.stringify({ ...pin, helper }))
  expect(() => f.stage()).toThrow("Invalid device helper identity")
})

test("symlinks in the licences are rejected", () => {
  if (process.platform === "win32") return
  const f = fixture()
  symlinkSync("/etc/hosts", join(f.platform("darwin-arm64"), "licenses/link"))
  expect(() => f.stage()).toThrow("Symlink in native artifact")
})
