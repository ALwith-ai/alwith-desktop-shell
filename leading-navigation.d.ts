import type { ComponentType, ReactNode } from "react"
export interface LeadingNavigationItem {
  id: string
  label: string
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>
  onClick: () => void
}
export interface LeadingNavigationProps {
  label: string
  items: readonly LeadingNavigationItem[]
  activePage: string | null
  children?: ReactNode
}
export declare function LeadingNavigation(props: LeadingNavigationProps): ReactNode
