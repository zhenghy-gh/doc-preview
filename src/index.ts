import DocPreview from './components/DocPreview.vue'
import { parseDocFile, parseDocFileWithFormat, parseDocFileFromBuffer, DocParser, enableDebugMode } from './utils/docParser'
import { parseWithWorker } from './utils/parseWithWorker'
import type { ParseResult, ParsedDocument, FormattedParagraph, CharacterFormat, ParagraphFormat, CharStyle, CharStyleSegment, CHP, PAP } from './utils/docFormat'
import type { WorkerParseResult } from './utils/parseWithWorker'

export { DocPreview, parseDocFile, parseDocFileWithFormat, parseDocFileFromBuffer, parseDocFileFromBuffer as parseDocFileWithWorker, DocParser, enableDebugMode, parseWithWorker }
export type { ParseResult, ParsedDocument, FormattedParagraph, CharacterFormat, ParagraphFormat, CharStyle, CharStyleSegment, CHP, PAP, WorkerParseResult }

export default DocPreview
