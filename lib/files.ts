// Files delivered through tracked links (private Supabase bucket "arquivos").

export const FILES_BUCKET = "arquivos"
export const MAX_FILE_BYTES = 50 * 1024 * 1024

// Safe, common formats only. HTML/SVG/JS/executables are refused: they could be
// abused as phishing pages or malware served from the storage domain.
export const ALLOWED_EXTENSIONS: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  epub: "application/epub+zip",
}

export function extensionOf(name: string): string {
  return (name.split(".").pop() || "").toLowerCase()
}

export function safeFileName(name: string): string {
  const ext = extensionOf(name)
  const base = name
    .slice(0, name.length - ext.length - 1)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return `${base || "arquivo"}.${ext}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`
}
