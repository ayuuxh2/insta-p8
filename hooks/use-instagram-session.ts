"use client"

import { useState, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"

export function useInstagramSession() {
    const [username, setUsername] = useState<string | null>(null)
    const [userId, setUserId] = useState<string | null>(null)
    const [profilePic, setProfilePic] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const searchParams = useSearchParams()
    const router = useRouter()

    useEffect(() => {
        const code = searchParams.get("code")

        const handleSession = async () => {
            // CASE A: New Login from Instagram
            if (code) {
                try {
                    const res = await fetch("/api/instagram/callback", {
                        method: "POST",
                        body: JSON.stringify({ code }),
                    })
                    const data = await res.json()

                    if (!data.success && data.error !== "Code already used") {
                        setError(data.error || "Não foi possível conectar o Instagram. Tente de novo.")
                        router.replace("/dashboard")
                    }
                    if (data.success) {
                        localStorage.setItem("ig_user_id", data.userId)
                        localStorage.setItem("ig_username", data.username)
                        if (data.profilePic) localStorage.setItem("ig_profile_pic", data.profilePic)

                        setUserId(data.userId)
                        setUsername(data.username)
                        setProfilePic(data.profilePic || null)
                        // Remove code from URL
                        router.replace("/dashboard")
                    }
                } catch (err) {
                    console.error("Login failed:", err)
                    setError("Não foi possível conectar o Instagram. Verifique sua internet e tente de novo.")
                }
            }
            // CASE B: Restore Session from LocalStorage
            else {
                const savedId = localStorage.getItem("ig_user_id")
                const savedName = localStorage.getItem("ig_username")

                if (savedId && savedName) {
                    setUserId(savedId)
                    setUsername(savedName)
                    setProfilePic(localStorage.getItem("ig_profile_pic"))
                }
            }
            setIsLoading(false)
        }

        handleSession()
    }, [searchParams, router])

    const logout = async () => {
        localStorage.removeItem("ig_user_id")
        localStorage.removeItem("ig_username")
        localStorage.removeItem("ig_profile_pic")
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {})
        setUsername(null)
        setUserId(null)
        setProfilePic(null)
        window.location.href = "/login"
    }

    return { userId, username, profilePic, isLoading, error, logout }
}
