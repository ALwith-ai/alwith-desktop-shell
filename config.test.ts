import { expect, test } from "bun:test"

import { desktopWindow } from "./config.js"

test("two brands share complete native defaults without retaining either identity", () => {
  for (const productName of ["First", "Second"]) {
    const result = desktopWindow({ productName, window: { width: 1200, height: 800, minWidth: 900, minHeight: 600 } })
    expect(result.title).toBe(productName)
    expect(result).toMatchObject({ transparent: true, decorations: true, titleBarStyle: "Overlay", hiddenTitle: true })
  }
})
