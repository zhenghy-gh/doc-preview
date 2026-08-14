import { describe, it } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { parseDocFileFromBuffer } from '../src/utils/docParser'

const here = dirname(fileURLToPath(import.meta.url))
const docsDir = resolve(here, '../docs')

describe('real doc quality audit', () => {
  const files = ['doc-101.doc','doc-161.doc','doc-261.doc','doc-321.doc','doc-500kb.doc','doc-100kb.doc','doc-1mb.doc','file-sample_100kB.doc','fsample1.doc','fsample3.doc','fsample4.doc','ftd-1.35mb.doc','openstd-n961.doc','uow-bio.doc','uow-cfp.doc','unicode-01022.doc','unicode-01351-N2376.doc','unicode-02006-zia.doc','unicode-02086-n2398.doc','unicode-03042-voting.doc','unicode-form.doc','unicode-n1750w97.doc','unicode-n2298.doc','unicode-n2532.doc','unicode-n4100.doc','unicode-n4250.doc','unicode-n4350.doc','unicode-n4400.doc']
  it('parse every fixture doc successfully', () => {
    for (const f of files) {
      const path = resolve(docsDir, f)
      if (!existsSync(path)) continue
      const data = readFileSync(path)
      const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      const t = performance.now()
      const r = parseDocFileFromBuffer(buf)
      const ms = Math.round(performance.now() - t)
      const paras = r.document?.paragraphs?.length ?? 0
      const textLen = r.text?.length ?? 0
      const flags = [
        r.success ? '' : 'FAIL',
        textLen === 0 ? 'EMPTY' : '',
        paras === 0 ? 'NOPARAS' : '',
        ms > 2000 ? 'SLOW' : '',
      ].filter(Boolean).join(',')
      console.log(`${f.padEnd(28)} ${String(ms).padStart(4)}ms paras=${String(paras).padStart(6)} text=${String(textLen).padStart(7)} ${flags}`)
    }
  })
})
