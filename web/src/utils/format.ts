export function formatTimestamp(filename: string) {
  const match = filename.match(/motion_(.+)\.mp4/)
  if (!match) return filename
  const iso = match[1].replace(
    /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/,
    (_m, h, m2, s, ms) => `T${h}:${m2}:${s}.${ms}Z`,
  )
  const date = new Date(iso)
  return isNaN(date.getTime()) ? match[1] : date.toLocaleString()
}
