import path from "path"

export const resolveUploadDir = (cwdBase: string): string => {
  const raw = (process.env.UPLOAD_DIR || "uploads").trim()
  if (!raw) return path.resolve(cwdBase, "uploads")
  return path.isAbsolute(raw) ? raw : path.resolve(cwdBase, raw)
}
