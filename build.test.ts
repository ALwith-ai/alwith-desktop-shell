import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { configureProject } from "./build.js"

interface TauriConfig {
  bundle: { resources: Record<string, string>; createUpdaterArtifacts?: boolean }
  app: { security: { assetProtocol: { scope: string[] } } }
  plugins?: { updater?: { endpoints?: string[] } & Record<string, unknown> }
}
function readTauriConfig(root: string) {
  return readFile(join(root, "src-tauri/tauri.conf.json"), "utf8").then((text) => JSON.parse(text) as TauriConfig)
}

test("brand configuration preserves user pages and uses a valid binary name", async () => {
  const root = await mkdtemp(join(tmpdir(), "shell-brand-"))
  try {
    await mkdir(join(root, "src-tauri"))
    await mkdir(join(root, "src"))
    await writeFile(join(root, "src/App.tsx"), "// user page")
    await writeFile(join(root, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    await writeFile(join(root, "package.json"), '{"name":"placeholder","version":"0.0.0","scripts":{"custom":"keep"}}')
    await writeFile(
      join(root, "src-tauri/Cargo.toml"),
      '[package]\nname = "placeholder"\nversion = "0.0.0"\n[[bin]]\nname = "placeholder"\npath = "src/main.rs"\n'
    )
    const config = {
      name: "my-app",
      productName: "My App & Co",
      identifier: "com.example.app",
      version: "0.1.0",
      icon: "icon.svg",
      languages: ["en"],
      preset: "chat",
      modules: ["chat", "auth", "store"],
      window: { width: 1000, height: 800, minWidth: 800, minHeight: 600 }
    }
    await writeFile(join(root, "alwith.app.json"), JSON.stringify(config))
    await configureProject(root, { icons: false })
    expect(JSON.parse(await readFile(join(root, "src-tauri/tauri.conf.json"), "utf8"))).toMatchObject({
      productName: "My App & Co",
      mainBinaryName: "my-app",
      app: { windows: [{ transparent: true }] }
    })
    expect(await readFile(join(root, "src/App.tsx"), "utf8")).toBe("// user page")
    expect(await readFile(join(root, "index.html"), "utf8")).toContain("My App &amp; Co")
    expect(await readFile(join(root, "src-tauri/Cargo.toml"), "utf8")).toContain('[[bin]]\nname = "my-app"')
    await writeFile(join(root, "alwith.app.json"), JSON.stringify({ ...config, modules: ["chat", "store"] }))
    await configureProject(root, { icons: false })
    const bare = await readTauriConfig(root)
    // The precompiled extension host ships in resources/native for every app; the Codex home is served for the toolbox.
    expect(bare.bundle.resources["resources/native"]).toBe("native")
    expect(bare.bundle.resources["resources/adapter"]).toBe("adapter")
    expect(bare.app.security.assetProtocol.scope).toEqual(["$HOME/.codex/**"])
    await writeFile(join(root, "alwith.app.json"), JSON.stringify({ ...config, icon: "../outside.svg" }))
    await expect(configureProject(root, { icons: false })).rejects.toThrow("escapes")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("updates emit the GitHub Releases or endpoint updater config and stay absent otherwise", async () => {
  const root = await mkdtemp(join(tmpdir(), "shell-updates-"))
  try {
    await mkdir(join(root, "src-tauri"))
    await mkdir(join(root, "src"))
    await writeFile(join(root, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    await writeFile(join(root, "package.json"), '{"name":"placeholder","version":"0.0.0"}')
    await writeFile(
      join(root, "src-tauri/Cargo.toml"),
      '[package]\nname = "placeholder"\nversion = "0.0.0"\n[[bin]]\nname = "placeholder"\npath = "src/main.rs"\n'
    )
    const pubkey = Buffer.from(
      "untrusted comment: minisign public key: 0123456789ABCDEF\nRWT0YFSbL/VlL5KaAIcjUiY7m00ujLO2ajmpby4NEPfgN07QpL30zpzv\n"
    ).toString("base64")
    const config = {
      name: "my-app",
      productName: "My App",
      identifier: "com.example.app",
      version: "0.1.0",
      icon: "icon.svg",
      languages: ["en"],
      preset: "chat",
      modules: ["chat", "store"],
      window: { width: 1000, height: 800, minWidth: 800, minHeight: 600 }
    }
    await writeFile(join(root, "alwith.app.json"), JSON.stringify(config))
    await configureProject(root, { icons: false })
    const plain = await readTauriConfig(root)
    expect(plain.plugins).toBeUndefined()
    expect(plain.bundle.createUpdaterArtifacts).toBeUndefined()
    await writeFile(
      join(root, "alwith.app.json"),
      JSON.stringify({ ...config, updates: { github: "example/my-app", pubkey: `${pubkey}\n` } })
    )
    await configureProject(root, { icons: false })
    const updating = await readTauriConfig(root)
    expect(updating.plugins).toEqual({
      updater: {
        pubkey,
        endpoints: ["https://github.com/example/my-app/releases/latest/download/latest.json"],
        requireSignedVersion: true,
        windows: { installMode: "passive" }
      }
    })
    expect(updating.bundle.createUpdaterArtifacts).toBeUndefined()
    const productEndpoint =
      "https://api.example.com/service/api/v1/open-source-versions/my-app/update/{{target}}-{{arch}}/{{current_version}}"
    await writeFile(
      join(root, "alwith.app.json"),
      JSON.stringify({ ...config, updates: { endpoints: [productEndpoint], pubkey, requireSignedVersion: false } })
    )
    await configureProject(root, { icons: false })
    expect((await readTauriConfig(root)).plugins?.updater).toEqual({
      pubkey,
      endpoints: [productEndpoint],
      requireSignedVersion: false,
      windows: { installMode: "passive" }
    })
    await writeFile(
      join(root, "alwith.app.json"),
      JSON.stringify({ ...config, updates: { github: "example/my-app", endpoints: [productEndpoint], pubkey } })
    )
    await configureProject(root, { icons: false })
    expect((await readTauriConfig(root)).plugins?.updater?.endpoints).toEqual([
      productEndpoint,
      "https://github.com/example/my-app/releases/latest/download/latest.json"
    ])
    for (const updates of [
      { github: "not-a-repo", pubkey },
      { github: "example/my-app", pubkey: "short" },
      { github: "example/my-app" },
      { pubkey },
      { endpoints: [], pubkey },
      { endpoints: ["http://example.com/latest.json"], pubkey },
      { endpoints: ["not a url"], pubkey },
      { endpoints: "https://example.com/latest.json", pubkey },
      { github: "example/my-app", pubkey, requireSignedVersion: "yes" },
      "example/my-app"
    ]) {
      await writeFile(join(root, "alwith.app.json"), JSON.stringify({ ...config, updates }))
      await expect(configureProject(root, { icons: false })).rejects.toThrow("updates")
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
