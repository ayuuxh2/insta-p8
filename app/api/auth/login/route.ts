import { type NextRequest, NextResponse } from "next/server"
import { checkPassword, createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth"

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json().catch(() => ({}))
    if (typeof password !== "string" || !(await checkPassword(password))) {
      // Slow down guessing.
      await new Promise(resolve => setTimeout(resolve, 1000))
      return NextResponse.json({ error: "Senha incorreta" }, { status: 401 })
    }

    const response = NextResponse.json({ ok: true })
    response.cookies.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions())
    return response
  } catch (error: any) {
    console.error("[auth/login]", error.message)
    return NextResponse.json({ error: "Login indisponível: verifique ADMIN_PASSWORD e SESSION_SECRET" }, { status: 500 })
  }
}
