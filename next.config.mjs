/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type errors previously shipped to production because this was `true`. The
  // codebase now typechecks clean (npx tsc --noEmit), so builds fail loudly on a
  // real type error instead of silently deploying it.
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  // schema.sql is read at runtime by lib/supabase-migrate.ts. Without this
  // entry, the serverless bundle for the Vercel function that imports
  // ensureSchema() will not include schema.sql, and the migration runner
  // will log "schema.sql not found" on every cold start.
  // Vercel bundles follow the application root by default; we extend
  // `outputFileTracingIncludes` so the file explicitly survives the trace.
  outputFileTracingIncludes: {
    "**/*": ["./schema.sql"],
  },
}

export default nextConfig
