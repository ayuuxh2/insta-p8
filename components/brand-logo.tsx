import { cn } from "@/lib/utils"

// CEE Store brand. Navy artwork for the light theme, white artwork for the dark theme
// (the `dark` class on <html> is set by the theme provider).
export function BrandLogo({ variant = "full", className }: { variant?: "full" | "icon"; className?: string }) {
  const base = variant === "full" ? "/brand/logo" : "/brand/icon"
  const alt = variant === "full" ? "CEE Store — comércio eletrônico" : "CEE Store"
  return (
    <>
      <img src={`${base}.png`} alt={alt} className={cn("w-auto dark:hidden", className)} />
      <img src={`${base}-dark.png`} alt={alt} className={cn("hidden w-auto dark:block", className)} />
    </>
  )
}
