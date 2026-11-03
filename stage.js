import { createHash } from "node:crypto"
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { join, relative } from "node:path"
const targets = {
  "aarch64-apple-darwin": "darwin-arm64",
  "x86_64-pc-windows-msvc": "win32-x64",
  "x86_64-unknown-linux-gnu": "linux-x64"
}
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
function files(root, directory = root) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error(`Symlink in native artifact: ${relative(root, path)}`)
    return stat.isDirectory() ? files(root, path) : [path]
  })
}
/** Locate an installed package root without going through its `exports` map. */
function packageRoot(from, name) {
  const require = createRequire(from)
  for (const directory of require.resolve.paths(name) ?? []) {
    const root = join(directory, name)
    if (existsSync(join(root, "package.json"))) return root
  }
  throw new Error(`Missing ${name}. Install it as a dependency of the application.`)
}
export function stageNativeModule(from, module, target, destination, licenses, contract) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(module)) throw new Error("Invalid native module identity")
  const platform = targets[target]
  if (!platform || (platform === "linux-x64" && module !== "computer"))
    throw new Error(`Unsupported native target: ${target}`)
  const name = `@alwith/module-${module}`
  const root = packageRoot(from, name)
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  if (manifest.name !== name) throw new Error(`Native package identity mismatch: ${manifest.name}`)
  const directory = join(root, "native", platform)
  if (!existsSync(join(directory, "artifact.json")))
    throw new Error(`${name}@${manifest.version} has no native library for ${target}`)
  const artifact = JSON.parse(readFileSync(join(directory, "artifact.json"), "utf8"))
  const stem = `alwith_native_${module.replaceAll("-", "_")}`
  const binary = platform.startsWith("darwin")
    ? `lib${stem}.dylib`
    : platform.startsWith("win32")
      ? `${stem}.dll`
      : `lib${stem}.so`
  if (
    artifact.module !== module ||
    !Number.isInteger(artifact.contract) ||
    artifact.contract < 1 ||
    (contract !== undefined && artifact.contract !== contract) ||
    artifact.target !== target ||
    artifact.abi !== 1 ||
    artifact.binary !== binary
  )
    throw new Error("Native artifact identity mismatch")
  if (sha256(join(directory, binary)) !== artifact.sha256) throw new Error("Native binary checksum mismatch")
  const helper = artifact.helper
  if (module === "device" && platform === "darwin-arm64" && !helper)
    throw new Error("Device helper is missing from the native artifact")
  if (helper) {
    if (
      module !== "device" ||
      platform !== "darwin-arm64" ||
      helper.binary !== "alwith-device-helper" ||
      !/^[a-f0-9]{40}$/.test(helper.revision ?? "")
    )
      throw new Error("Invalid device helper identity")
    if (sha256(join(directory, helper.binary)) !== helper.sha256) throw new Error("Device helper checksum mismatch")
  }
  const staged = []
  mkdirSync(destination, { recursive: true })
  cpSync(join(directory, binary), join(destination, binary))
  staged.push({ path: join(destination, binary), signing: "resign" })
  if (helper) {
    const path = join(destination, helper.binary)
    cpSync(join(directory, helper.binary), path)
    // npm does not keep the helper's execute bit, so the staged copy gets it here.
    chmodSync(path, 0o755)
    staged.push({ path, signing: "resign" })
  }
  const legal = join(licenses, `alwith-native-${module}`)
  rmSync(legal, { recursive: true, force: true })
  mkdirSync(legal, { recursive: true })
  cpSync(join(root, "LICENSE"), join(legal, "LICENSE"))
  for (const item of ["THIRD_PARTY_NOTICES.md", "licenses"])
    cpSync(join(directory, item), join(legal, item), { recursive: true })
  for (const path of files(legal)) staged.push({ path, signing: "resource" })
  return staged
}
