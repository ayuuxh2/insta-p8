"use client"

import { useEffect, useState } from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { MobileNav } from "@/components/layout/mobile-nav"
import { useInstagramSession } from "@/hooks/use-instagram-session"
import { Loader2 } from "lucide-react"

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const { username, profilePic, logout, isLoading } = useInstagramSession()
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

    useEffect(() => {
        setSidebarCollapsed(localStorage.getItem("insta-p8-sidebar") === "collapsed")
    }, [])

    const toggleSidebar = () => {
        setSidebarCollapsed(value => {
            const next = !value
            localStorage.setItem("insta-p8-sidebar", next ? "collapsed" : "expanded")
            return next
        })
    }

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center bg-background text-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="flex min-h-screen bg-background text-foreground">
            {/* Desktop Sidebar */}
            <div className={`hidden md:flex md:flex-col md:fixed md:inset-y-0 z-50 transition-[width] duration-200 ${sidebarCollapsed ? "md:w-[72px]" : "md:w-64"}`}>
                <Sidebar
                    className="h-full border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
                    username={username || "Usuário"}
                    profilePic={profilePic}
                    onLogout={logout}
                    collapsed={sidebarCollapsed}
                    onToggle={toggleSidebar}
                />
            </div>

            {/* Main Content Area */}
            <div className={`flex-1 flex flex-col transition-[padding] duration-200 ${sidebarCollapsed ? "md:pl-[72px]" : "md:pl-64"}`}>
                {/* Mobile Header (Visible only on small screens) */}
                <header className="md:hidden h-16 border-b border-border bg-background flex items-center justify-between px-4 sticky top-0 z-40">
                    <span className="font-serif-display text-xl text-foreground">CEE Automação</span>
                    <MobileNav username={username || "Usuário"} profilePic={profilePic} onLogout={logout} />
                </header>

                <main className="dashboard-canvas flex-1 relative overflow-auto">
                    {children}
                </main>
            </div>
        </div>
    )
}
