export interface CHP {
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  fontName?: string
  fontCharset?: number
}

export interface PAP {
  alignment?: 'left' | 'center' | 'right' | 'justify'
  indent?: number
  lineSpacing?: number
}

export interface FormattedRun {
  text: string
  charFormat: CHP
  paraFormat: PAP
}

export interface FormattedParagraph {
  runs: FormattedRun[]
  paraFormat: PAP
}

export interface ParsedDocument {
  paragraphs: FormattedParagraph[]
}

export interface ParseResult {
  success: boolean
  document?: ParsedDocument
  text?: string
  error?: string
}
