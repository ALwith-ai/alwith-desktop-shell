import { cn } from "cn"
import type { ComponentType, ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export interface LeadingNavigationItem {
  id: string
  label: string
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>
  onClick: () => void
}

export interface LeadingNavigationProps {
  /** The rail's accessible name (U: "Leading navigation"). */
  label: string
  items: readonly LeadingNavigationItem[]
  activePage: string | null
  children?: ReactNode
}

/** U's rail on the leading screen: 36px icon buttons with inline-end tooltips, the active page highlighted. */
export function LeadingNavigation({ label, items, activePage, children }: LeadingNavigationProps) {
  return (
    <nav aria-label={label} className="leading-navigation">
      {items.map(({ id, label, icon: Icon, onClick }) => (
        <Tooltip key={id}>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label={label}
                aria-current={activePage === id ? "page" : undefined}
                onClick={onClick}
                className={cn(
                  "text-muted-foreground hover:text-foreground aria-[current=page]:bg-foreground/5 aria-[current=page]:text-foreground size-9 rounded-[10px] motion-reduce:transition-none"
                )}
              >
                <Icon aria-hidden="true" className="size-[18px]" />
              </Button>
            }
          />
          <TooltipContent side="inline-end">{label}</TooltipContent>
        </Tooltip>
      ))}
      {children}
    </nav>
  )
}
