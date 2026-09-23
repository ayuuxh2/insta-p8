"use client"

import { useState, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"

export function useInstagramSession() {
    const [username, setUsername] = useState<string | null>(null)
    const [userId, setUserId] = useState<string | null>(null)
    const [profilePic, setProfilePic] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    const searchParams = useSearchParams()
    const router = useRouter()

    useEffect(() => {
        const code = searchParams.get("code")

        // The dashboard's API routes authorise on the signed `insta_session` cookie,
        // so an account found only in localStorage (expired/missing session) would
        // render an empty dashboard with no explanation. Verify against the server
        // and send the user back to reconnect Instagram when the session is gone.
        const clearLocalSession = () => {
            localStorage.removeItem("ig_user_id")
            localStorage.removeItem("ig_username")
            localStorage.removeItem("ig_profile_pic")
            setUsername(null)
            setUserId(null)
            setProfilePic(null)
        }

        const handleSession = async () => {
            // CASE A: New Login from Instagram
            if (code) {
                try {
                    const res = await fetch("/api/instagram/callback", {
                        method: "POST",
                        body: JSON.stringify({ code }),
                    })
                    const data = await res.json()

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
                }
            }
            // CASE B: Restore Session from LocalStorage (only if the server still recognises it)
            else {
                const savedId = localStorage.getItem("ig_user_id")
                const savedName = localStorage.getItem("ig_username")

                if (savedId && savedName) {
                    try {
                        const res = await fetch("/api/session", { cache: "no-store" })
                        if (res.ok) {
                            const data = await res.json()
                            setUserId(data.userId ?? savedId)
                            setUsername(data.username ?? savedName)
                            setProfilePic(localStorage.getItem("ig_profile_pic"))
                        } else {
                            clearLocalSession()
                            router.replace("/")
                        }
                    } catch (err) {
                        console.error("Session check failed:", err)
                    }
                }
            }
            setIsLoading(false)
        }

        handleSession()
    }, [searchParams, router])

    const logout = async () => {
        // The session cookie is httpOnly: only the server can clear it.
        try {
            await fetch("/api/session", { method: "DELETE" })
        } catch (err) {
            console.error("Logout failed:", err)
        }
        localStorage.removeItem("ig_user_id")
        localStorage.removeItem("ig_username")
        localStorage.removeItem("ig_profile_pic")
        setUsername(null)
        setUserId(null)
        setProfilePic(null)
        router.push("/")
    }

    return { userId, username, profilePic, isLoading, logout }
}
