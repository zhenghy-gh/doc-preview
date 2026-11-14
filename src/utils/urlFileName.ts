function sanitizeFileName(candidate: string): string {
  let fileName = candidate
  try {
    const decoded = decodeURIComponent(candidate)
    if (!/[\/\\\u0000-\u001f\u007f]/.test(decoded)) fileName = decoded
  } catch {
    // Keep malformed percent escapes as literal text, then remove unsafe characters below.
  }
  return fileName.replace(/[\/\\\u0000-\u001f\u007f]/g, '').trim() || 'document.doc'
}

export function getFileNameFromUrl(url: string, baseUrl?: string): string {
  const fallbackPath = url.split(/[?#]/, 1)[0]
  const fallbackSegment = fallbackPath.split('/').pop() || ''
  try {
    const defaultBaseUrl = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/'
    const pathname = new URL(url, baseUrl ?? defaultBaseUrl).pathname
    const segment = pathname.slice(pathname.lastIndexOf('/') + 1)
    return sanitizeFileName(segment || fallbackSegment)
  } catch {
    return sanitizeFileName(fallbackSegment)
  }
}
