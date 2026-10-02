"use client"

import { Moon, Sun } from "lucide-react"
import { flushSync } from "react-dom"
import { useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

/**
 * Pill toggle for light/dark theme. Surfaces current state and the next
 * action via label and aria-label so it's usable without color cues.
 *
 * Color contrast:
 *   - track border uses --border (≥3:1 on background)
 *   - thumb uses --card + --card-foreground (≥4.5:1)
 *   - icons inside thumb pick the matching foreground token
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, toggle } = useTheme()
  const isDark = resolvedTheme === "dark"

  const handleToggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      toggle()
      return
    }

    const x = event.clientX
    const y = event.clientY
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    const circle = document.createElement("span")
    const size = 20

    Object.assign(circle.style, {
      position: "fixed",
      left: `${x - size / 2}px`,
      top: `${y - size / 2}px`,
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: "9999px",
      background: isDark ? "#fafafa" : "#090909",
      pointerEvents: "none",
      zIndex: "2147483647",
      transform: "scale(0)",
    })
    document.body.appendChild(circle)

    const animation = circle.animate(
      [{ transform: "scale(0)" }, { transform: `scale(${(radius * 2) / size})` }],
      { duration: 480, easing: "cubic-bezier(.4, 0, .2, 1)", fill: "forwards" },
    )

    animation.finished.then(() => {
      flushSync(() => toggle())
      circle.remove()
    }).catch(() => {
      toggle()
      circle.remove()
    })
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      role="switch"
      aria-checked={isDark}
      aria-label={`Mudar para tema ${isDark ? "claro" : "escuro"}`}
      title={`Mudar para tema ${isDark ? "claro" : "escuro"}`}
      className={cn(
        "group relative inline-flex h-8 w-16 shrink-0 items-center rounded-full border border-border bg-secondary transition-colors",
        "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 h-6 w-6 rounded-full bg-card text-card-foreground shadow-sm border border-border transition-all duration-200 ease-out flex items-center justify-center",
          isDark ? "left-[calc(100%-1.625rem-2px)]" : "left-[2px]",
        )}
      >
        {isDark ? (
          <Moon className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Sun className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </span>
      {/* Hidden but readable label for assistive tech that ignores aria-label */}
      <span className="sr-only">{isDark ? "Tema escuro ativado" : "Tema claro ativado"}</span>
    </button>
  )
}
