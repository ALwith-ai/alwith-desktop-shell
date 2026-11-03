import { expect, test } from "bun:test"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { ThemeModePicker } from "./settings.js"

test("theme mode picker renders ALwith Desktop's three preview cards with the value checked", () => {
  const html = renderToStaticMarkup(
    createElement(ThemeModePicker, {
      value: "system",
      onChange: () => {},
      labels: { light: "Light", system: "System", dark: "Dark" },
      label: "Theme"
    })
  )
  expect(html).toContain('role="radiogroup" aria-label="Theme"')
  expect(html.match(/role="radio"/g)).toHaveLength(3)
  expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
  expect(html.indexOf("Light")).toBeLessThan(html.indexOf("System"))
  expect(html.indexOf("System")).toBeLessThan(html.indexOf("Dark"))
  // The checked card carries the ring border; the system card is split light / dark.
  expect(html).toContain("border-ring")
  expect(html).toContain("bg-[#f5f5f5]")
  expect(html).toContain("bg-[#1e1e1e]")
})
