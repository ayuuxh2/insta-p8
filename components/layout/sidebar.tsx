"use client"

import type React from "react"
import { cn } from "@/lib/utils"
import {
  Zap, LayoutDashboard, LogOut, Settings, BarChart3,
  MessageSquare, Snowflake, Send,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

const NAV = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Overview" },
  { href: "/dashboard/automations", icon: Zap, label: "Automations" },
  { href: "/dashboard/inbox", icon: MessageSquare, label: "Inbox" },
  { href: "/dashboard/ice-breakers", icon: Snowflake, label: "Ice breakers" },
  { href: "/dashboard/analytics", icon: BarChart3, label: "Analytics" },
]

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  username?: string
  className?: string
  onLogout?: () => void
  onNavigate?: () => void
}

export function Sidebar({ className, username = "creator", onLogout, onNavigate, ...props }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside className={cn("flex flex-col bg-[#0a0a09]", className)} {...props}>
      {/* Brand */}
      <div className="px-5 pt-6 pb-5 flex items-center gap-2.5">
        <div className="w-7 h-7 bg-[#ffe14d] text-black rounded-md flex items-center justify-center shrink-0">
          <Zap className="w-3.5 h-3.5" strokeWidth={2.5} />
        </div>
        <span className="font-mono-ui text-sm font-bold tracking-tight text-white">insta-p8</span>
      </div>

      <div className="mx-5 h-px bg-white/[0.06]" />

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-[13px] transition-colors relative",
                active
                  ? "text-white bg-white/[0.06]"
                  : "text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.03]",
              )}
            >
              {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full bg-[#ffe14d]" />}
              <Icon className={cn("w-4 h-4 shrink-0", active ? "text-[#ffe14d]" : "")} strokeWidth={active ? 2.2 : 1.8} />
              <span className={active ? "font-medium" : ""}>{label}</span>
            </Link>
          )
        })}

        <div className="pt-5 pb-1 px-3">
          <div className="h-px bg-white/[0.06]" />
        </div>

        <Link
          href="/dashboard/settings"
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md text-[13px] transition-colors relative",
            pathname === "/dashboard/settings"
              ? "text-white bg-white/[0.06]"
              : "text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.03]",
          )}
        >
          {pathname === "/dashboard/settings" && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full bg-[#ffe14d]" />}
          <Settings className="w-4 h-4 shrink-0" strokeWidth={1.8} />
          <span>Settings</span>
        </Link>

        <a
          href="https://t.me/instagramautomationp8"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-3 py-2 rounded-md text-[13px] text-neutral-500 hover:text-[#2AABEE] hover:bg-white/[0.03] transition-colors"
        >
          <Send className="w-4 h-4 shrink-0" strokeWidth={1.8} />
          <span>Get help</span>
        </a>
      </nav>

      {/* Account */}
      <div className="px-3 pb-4">
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-white/[0.06] group">
          <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-500 p-[1.5px] shrink-0">
            <div className="w-full h-full rounded-full bg-black flex items-center justify-center">
              <span className="text-[10px] font-bold text-white">{username.charAt(0).toUpperCase()}</span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-white truncate">@{username}</p>
            <p className="font-mono-ui text-[9px] uppercase tracking-wider text-neutral-600">connected</p>
          </div>
          <button
            onClick={onLogout}
            title="Log out"
            className="p-1.5 rounded-md text-neutral-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  )
}