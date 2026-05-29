import DocPreview from './components/DocPreview.vue'
import { parseDocFile, parseDocFileWithFormat, DocParser } from './utils/docParser'
import type { ParseResult, ParsedDocument, FormattedParagraph, FormattedRun, CHP, PAP } from './utils/docFormat'

export { DocPreview, parseDocFile, parseDocFileWithFormat, DocParser }
export type { ParseResult, ParsedDocument, FormattedParagraph, FormattedRun, CHP, PAP }

export default DocPreview
