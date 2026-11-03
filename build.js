import { existsSync } from "node:fs"
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { extname, join, resolve, sep } from "node:path"

import { desktopWindow } from "./config.js"
export function validateConfig(value) {
  const c = value
  if (!c || !/^[a-z][a-z0-9-]{0,213}$/.test(c.name ?? "")) throw Error("name must be a lowercase npm package name")
  if (
    typeof c.productName !== "string" ||
    !c.productName.trim() ||
    [...c.productName].some((character) => character < " " || character === "/" || character === "\\")
  )
    throw Error("productName must be a nonempty application name")
  if (!/^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z][A-Za-z0-9-]*){2,}$/.test(c.identifier ?? ""))
    throw Error("identifier must be an explicit reverse-DNS bundle ID")
  if (!/^\d+\.\d+\.\d+$/.test(c.version ?? "")) throw Error("version must have three numeric components")
  if (c.preset !== "chat") throw Error("Only the chat preset is available")
  if (!Array.isArray(c.languages) || !c.languages.length || c.languages.some((l) => !["en", "zh-CN"].includes(l)))
    throw Error("Supported languages are en and zh-CN")
  if (!Array.isArray(c.modules) || !["chat", "store"].every((m) => c.modules.includes(m)))
    throw Error("The chat preset requires chat and store")
  for (const key of ["width", "height", "minWidth", "minHeight"])
    if (!Number.isInteger(c.window?.[key]) || c.window[key] <= 0) throw Error(`window.${key} must be positive`)
  if (c.window.minWidth > c.window.width || c.window.minHeight > c.window.height)
    throw Error("Minimum window dimensions must not exceed initial dimensions")
  safePath("/app", c.icon)
  if (c.updates !== undefined) {
    if (!c.updates || typeof c.updates !== "object" || Array.isArray(c.updates))
      throw Error("updates must be an object with pubkey and github or endpoints")
    const { github, endpoints, pubkey, requireSignedVersion } = c.updates
    if (github === undefined && endpoints === undefined) throw Error("updates needs github or endpoints")
    if (
      github !== undefined &&
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/.test(
        typeof github === "string" ? github : ""
      )
    )
      throw Error("updates.github must be a GitHub repository as owner/repo")
    if (endpoints !== undefined) {
      if (!Array.isArray(endpoints) || !endpoints.length)
        throw Error("updates.endpoints must be a nonempty list of HTTPS URLs")
      for (const endpoint of endpoints)
        if (!httpsUrl(endpoint)) throw Error(`updates.endpoints: ${JSON.stringify(endpoint)} is not an HTTPS URL`)
    }
    if (typeof pubkey !== "string" || !/^[A-Za-z0-9+/]+=*$/.test(pubkey.trim()) || pubkey.trim().length < 64)
      throw Error("updates.pubkey must be the base64 public key written by the updater key generator")
    if (requireSignedVersion !== undefined && typeof requireSignedVersion !== "boolean")
      throw Error("updates.requireSignedVersion must be true or false")
  }
  return c
}
/** The static manifest tauri-plugin-updater reads; `releases/latest/download` always resolves to the newest published release. */
export function updaterEndpoint(github) {
  return `https://github.com/${github}/releases/latest/download/latest.json`
}
/** An endpoint on any host; tauri-plugin-updater fills `{{target}}`, `{{arch}}`, `{{current_version}}` and `{{bundle_type}}`. */
function httpsUrl(value) {
  if (typeof value !== "string" || /\s/.test(value)) return !1
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password
  } catch {
    return !1
  }
}
/** `plugins.updater` for an `updates` object: endpoints first, then the GitHub Releases manifest. */
export function updaterConfig(updates) {
  return {
    pubkey: updates.pubkey.trim(),
    endpoints: [...(updates.endpoints ?? []), ...(updates.github ? [updaterEndpoint(updates.github)] : [])],
    requireSignedVersion: updates.requireSignedVersion ?? !0,
    // The installer runs with a progress bar and no questions, then relaunches the app.
    windows: { installMode: "passive" }
  }
}
export function safePath(root, relative) {
  if (typeof relative !== "string" || !relative || relative.includes("\\") || relative.startsWith("/"))
    throw Error("Expected a relative project path")
  const path = resolve(root, relative)
  if (!path.startsWith(resolve(root) + sep)) throw Error(`Path escapes the project: ${relative}`)
  return path
}
const json = (value) =>
    `${JSON.stringify(value, null, 2)}
`,
  html = (text) =>
    text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
export async function configureProject(root, options = {}) {
  const c = validateConfig(JSON.parse(await readFile(join(root, "alwith.app.json"), "utf8"))),
    manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
  manifest.name = c.name
  manifest.version = c.version
  await writeFile(join(root, "package.json"), json(manifest))
  let cargo = await readFile(join(root, "src-tauri/Cargo.toml"), "utf8")
  cargo = cargo
    .replace(/(\[package\]\s*\nname = )[^\n]+/, `$1${JSON.stringify(c.name)}`)
    .replace(/(\[package\][\s\S]*?\nversion = )[^\n]+/, `$1${JSON.stringify(c.version)}`)
    .replace(/(\[\[bin\]\]\s*\nname = )[^\n]+/, `$1${JSON.stringify(c.name)}`)
  await writeFile(join(root, "src-tauri/Cargo.toml"), cargo)
  await writeFile(
    join(root, "index.html"),
    `<!doctype html>
<html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${html(c.productName)}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
`
  )
  const iconName = `app-icon${extname(c.icon)}`
  await mkdir(join(root, "public"), { recursive: !0 })
  await copyFile(safePath(root, c.icon), join(root, "public", iconName))
  await mkdir(join(root, "src/generated"), { recursive: !0 })
  await writeFile(
    join(root, "src/generated/app-icon.ts"),
    `// Generated from alwith.app.json.
export default ${JSON.stringify(`/${iconName}`)};
`
  )
  const config = {
    $schema: "https://schema.tauri.app/config/3.0.0-alpha.3",
    productName: c.productName,
    mainBinaryName: c.name,
    version: c.version,
    identifier: c.identifier,
    build: {
      frontendDist: "../dist",
      devUrl: "http://localhost:1420",
      beforeDevCommand: "bun run stage && bun run dev",
      beforeBuildCommand: "bun run stage && bun run build"
    },
    // The asset protocol serves local skill icons and plugin screenshots from the Codex home (the toolbox), plus Vibemon assets with auth.
    app: {
      windows: [desktopWindow(c)],
      security: {
        csp: null,
        assetProtocol: {
          enable: true,
          scope: ["$HOME/.codex/**", ...(c.modules.includes("auth") ? ["$APPDATA/vibemon/**"] : [])]
        }
      }
    },
    // resources/native carries the precompiled extension host (always) and the native auth client (with auth).
    bundle: {
      active: !0,
      category: "Productivity",
      targets: ["app", "dmg"],
      externalBin: ["binaries/alwith-runtime", "binaries/bun", "binaries/codex", "binaries/codex-code-mode-host"],
      resources: { "resources/adapter": "adapter", "resources/native": "native", "resources/licenses": "licenses" },
      icon: ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"],
      macOS: { minimumSystemVersion: "26.6", entitlements: "./Entitlements.plist" }
    },
    // Without `updates` no updater config exists and the generated app leaves tauri-plugin-updater unregistered.
    ...(c.updates
      ? {
          plugins: { updater: updaterConfig(c.updates) }
        }
      : {})
  }
  await writeFile(join(root, "src-tauri/tauri.conf.json"), json(config))
  if (options.icons !== !1) await generateIcons(root, c.icon)
}
async function generateIcons(root, icon) {
  if (
    (await Bun.spawn(["bun", "run", "tauri", "icon", icon, "-o", "src-tauri/icons"], {
      cwd: root,
      stdout: "inherit",
      stderr: "inherit"
    }).exited) !== 0
  )
    throw Error("Icon generation failed")
}
/** Generates the Tauri bundle icons from `alwith.app.json` when they are missing (a fresh project); existing icons stay. */
export async function ensureIcons(root) {
  const icons = ["32x32.png", "128x128.png", "128x128@2x.png", "icon.icns", "icon.ico"]
  if (icons.every((name) => existsSync(join(root, "src-tauri/icons", name)))) return
  const c = validateConfig(JSON.parse(await readFile(join(root, "alwith.app.json"), "utf8")))
  await generateIcons(root, c.icon)
}
