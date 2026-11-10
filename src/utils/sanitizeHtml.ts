import DOMPurify from 'dompurify'

export function sanitizePreviewHtml(html: string): string {
  return DOMPurify.sanitize(html)
}
