import { NextResponse } from "next/server"

export async function GET() {
  const envCheck = {
    // Supabase
    has_SUPABASE_URL: !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
    has_SUPABASE_ANON_KEY: !!(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY),
    has_SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabase_url_preview: (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.substring(0, 20) || "none",

    // Instagram
    has_INSTAGRAM_APP_ID: !!(process.env.INSTAGRAM_APP_ID || process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID),
    has_INSTAGRAM_APP_SECRET: !!process.env.INSTAGRAM_APP_SECRET,
    has_INSTAGRAM_REDIRECT_URI: !!(process.env.INSTAGRAM_REDIRECT_URI || process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI),
    has_INSTAGRAM_WEBHOOK_VERIFY_TOKEN: !!process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN,
    has_META_APP_SECRET: !!process.env.META_APP_SECRET,

    // AI Keys
    has_GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    has_GROQ_API_KEY: !!process.env.GROQ_API_KEY,
    has_OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
  }

  return NextResponse.json({
    status: "ok",
    environment_variables: envCheck,
    node_env: process.env.NODE_ENV,
  })
}
