"use client"

import type React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronLeft, ChevronRight, LogOut } from "lucide-react"
import { cn } from "@/lib/utils"
import { BrandLogo } from "@/components/brand-logo"
import { ThemeToggle } from "@/components/theme-toggle"

const NAV = [
  { href: "/dashboard", label: "Início", icon: "/icons/home.svg" },
  { href: "/dashboard/automations", label: "Respostas automáticas", icon: "/icons/journal.svg" },
  { href: "/dashboard/inbox", label: "Conversas", icon: "/icons/chat.svg" },
  { href: "/dashboard/contacts", label: "Contatos", icon: "/icons/contacts.svg" },
  { href: "/dashboard/agenda", label: "Agenda de posts", icon: "/icons/calendar.svg" },
  { href: "/dashboard/vitrine", label: "Vitrine (link da bio)", icon: "/icons/store.svg" },
  { href: "/dashboard/files", label: "Arquivos", icon: "/icons/files.svg" },
  { href: "/dashboard/ice-breakers", label: "Iniciadores de conversa", icon: "/icons/squads.svg" },
  { href: "/dashboard/analytics", label: "Métricas", icon: "/icons/analytics.svg" },
]

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  username?: string
  profilePic?: string | null
  onLogout?: () => void
  onNavigate?: () => void
  collapsed?: boolean
  onToggle?: () => void
}

export function Sidebar({ className, username = "usuario", profilePic, onLogout, onNavigate, collapsed = false, onToggle, ...props }: SidebarProps) {
  const pathname = usePathname()

  const itemClass = (active: boolean) => cn(
    "relative flex h-10 items-center rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
    collapsed ? "justify-center px-0" : "gap-3 px-3",
    active ? "bg-sidebar-accent text-sidebar-foreground" : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
  )

  return (
    <aside className={cn("flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground", className)} {...props}>
      <div className={cn("flex h-16 items-center border-b border-sidebar-border", collapsed ? "justify-center" : "px-3")}>
        <Link href="/dashboard" onClick={onNavigate} aria-label="CEE Automação — início" className={cn("flex items-center gap-2.5 rounded-lg", !collapsed && "px-2")}>
          {collapsed ? <BrandLogo variant="icon" className="h-8" /> : <BrandLogo className="h-9" />}
        </Link>
        {!collapsed && onToggle && <button onClick={onToggle} aria-label="Recolher menu" title="Recolher menu" className="ml-auto flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"><ChevronLeft className="size-4" /></button>}
      </div>

      {collapsed && onToggle && <div className="px-3 pt-3"><button onClick={onToggle} aria-label="Expandir menu" title="Expandir menu" className="flex size-10 w-full items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"><ChevronRight className="size-4" /></button></div>}

      <nav className="flex-1 space-y-1 px-3 py-3" aria-label="Navegação do painel">
        {NAV.map(item => {
          const active = pathname === item.href
          return <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} aria-label={collapsed ? item.label : undefined} title={collapsed ? item.label : undefined} className={itemClass(active)}>
            <img src={item.icon} alt="" className={cn("size-4 shrink-0 dark:invert", active && item.href === "/dashboard" && "dark:invert-0")} />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        })}

        <div className="my-3 h-px bg-sidebar-border" />

        <Link href="/dashboard/settings" onClick={onNavigate} aria-current={pathname === "/dashboard/settings" ? "page" : undefined} aria-label={collapsed ? "Preferências" : undefined} title={collapsed ? "Preferências" : undefined} className={itemClass(pathname === "/dashboard/settings")}>
          <img src="/icons/profile.svg" alt="" className="size-4 shrink-0 dark:invert" />
          {!collapsed && <span>Preferências</span>}
        </Link>
      </nav>

      <div className="border-t border-sidebar-border p-3">
        {!collapsed && <div className="mb-3 flex items-center justify-between px-1"><span className="text-xs text-muted-foreground">Aparência</span><ThemeToggle className="h-7 w-14" /></div>}
        <div className={cn("flex items-center rounded-lg bg-sidebar-accent p-2", collapsed ? "justify-center" : "gap-2.5")}>
          <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
            {profilePic ? <img src={profilePic} alt={username} className="size-full object-cover" /> : username.charAt(0).toUpperCase()}
          </div>
          {!collapsed && <><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">@{username}</p><p className="mt-0.5 text-[11px] text-muted-foreground">Instagram conectado</p></div><button onClick={onLogout} aria-label="Sair" title="Sair" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar hover:text-destructive"><LogOut className="size-4" /></button></>}
        </div>
      </div>
    </aside>
  )
}
