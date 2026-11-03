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
      throw Error("updates must be an object with github and pubkey")
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/.test(c.updates.github ?? ""))
      throw Error("updates.github must be a GitHub repository as owner/repo")
    if (
      typeof c.updates.pubkey !== "string" ||
      !/^[A-Za-z0-9+/]+=*$/.test(c.updates.pubkey.trim()) ||
      c.updates.pubkey.trim().length < 64
    )
      throw Error("updates.pubkey must be the base64 public key written by the updater key generator")
  }
  return c
}
/** The static manifest tauri-plugin-updater reads; `releases/latest/download` always resolves to the newest published release. */
export function updaterEndpoint(github) {
  return `https://github.com/${github}/releases/latest/download/latest.json`
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
    // The asset protocol serves local skill icons and plugin screenshots from the Codex home (the toolbox), plus pet assets with auth.
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
          plugins: {
            updater: {
              pubkey: c.updates.pubkey.trim(),
              endpoints: [updaterEndpoint(c.updates.github)],
              requireSignedVersion: !0
            }
          }
        }
      : {})
  }
  await writeFile(join(root, "src-tauri/tauri.conf.json"), json(config))
  if (options.icons !== !1) {
    if (
      (await Bun.spawn(["bun", "run", "tauri", "icon", c.icon, "-o", "src-tauri/icons"], {
        cwd: root,
        stdout: "inherit",
        stderr: "inherit"
      }).exited) !== 0
    )
      throw Error("Icon generation failed")
  }
}
