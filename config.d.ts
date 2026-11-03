export declare function desktopWindow(app: {
  productName: string
  window: { width: number; height: number; minWidth: number; minHeight: number }
}): {
  label: string
  title: string
  width: number
  height: number
  minWidth: number
  minHeight: number
  transparent: boolean
  decorations: boolean
  titleBarStyle: "Overlay"
  hiddenTitle: boolean
}
