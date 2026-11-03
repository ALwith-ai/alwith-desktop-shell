import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import manifest from "./package.json"

test("published theme contains complete light and dark defaults", () => {
  const css = readFileSync(new URL("./theme.css", import.meta.url), "utf8")
  for (const selector of [":root", ".dark"]) {
    const body = css.slice(css.indexOf(selector)).split("}")[0]
    for (const token of [
      "background",
      "foreground",
      "popover",
      "primary",
      "muted",
      "border",
      "sidebar",
      "sidebar-foreground"
    ]) {
      expect(body).toMatch(new RegExp(`--${token}:\\s*[^;]+;`))
    }
  }
  expect(manifest.files).toContain("theme.css")
  expect(manifest.exports["./theme.css"]).toBe("./theme.css")
})
