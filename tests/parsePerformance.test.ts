import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseDocFileFromBuffer } from '../src/utils/docParser'

const here = dirname(fileURLToPath(import.meta.url))
const docsDir = resolve(here, '../docs')

/**
 * Performance regression guard.
 *
 * These samples exercise the text-length-dependent hot paths that were
 * previously O(L^2) (per-character Chinese-font lookup in detectCharacterStyles)
 * and O(n^3) (tandem-repeat scan in removeInternalDuplicates). Before the
 * optimisation the same files parsed in ~2300-3300ms; healthy parses now
 * finish well under 600ms. The generous ceilings below never trip on healthy
 * code but catch a reintroduced algorithmic blow-up (which pushes times past
 * ~2000ms). Timing is deliberately loose to stay stable under CI load.
 *
 * Each entry is skipped gracefully when its sample file is not present, so the
 * suite still passes in checkouts without the docs/ fixtures.
 */
const SAMPLES: Array<{ file: string; maxMs: number; minTextLen?: number; minTableParas?: number }> = [
  // detectCharacterStyles stress (unicode) — healthy ~130-185ms, pre-optimisation ~3070ms.
  // minTextLen also guards the CLX bare-Pcdt fix (regression → empty/truncated body).
  { file: 'unicode-n4100.doc', maxMs: 1500, minTextLen: 10000 },
  { file: 'unicode-n4250.doc', maxMs: 1500, minTextLen: 10000 },
  // removeInternalDuplicates stress — healthy ~530ms (O(n^2) scan), pre-optimisation ~2360ms
  { file: 'fsample4.doc', maxMs: 1800, minTextLen: 400000 },
  // general large-file guard — healthy ~50-70ms
  { file: 'doc-1mb.doc', maxMs: 1500 },
  // Large 1Table/WordDocument streams (>1000 sectors) — guards the readStream fix
  // that used to truncate at a fixed 1000-sector (512000-byte) ceiling, which
  // left the CLX unreadable and yielded ~124 chars from this 1.5MB document.
  { file: 'unicode-01351-N2376.doc', maxMs: 2500, minTextLen: 300000 },
  // Binary-signature false positive — the piece-boundary text held substrings
  // like "IBM"/"AVI" that tripped the (now piece-path-disabled) binary guard and
  // truncated real prose (openstd ~539→33461, form ~75→13879 chars).
  { file: 'openstd-n961.doc', maxMs: 1500, minTextLen: 20000 },
  { file: 'unicode-form.doc', maxMs: 1500, minTextLen: 8000 },
  // No table stream (embedded-Excel compound file) — guards the FibBase
  // fcMin/fcMac fallback; before it this file yielded 9 garbage chars.
  { file: 'doc-101.doc', maxMs: 1000, minTextLen: 800 },
  // Table-heavy Word 97 file — guards the FKP (formatted disk page) parsing
  // path and the TTP row splitting; before it this file produced 10 glued
  // paragraphs with zero spec-level table info.
  { file: 'unicode-n1750w97.doc', maxMs: 1500, minTextLen: 20000, minTableParas: 50 },
]

describe('parse performance regression', () => {
  for (const { file, maxMs, minTextLen, minTableParas } of SAMPLES) {
    const path = resolve(docsDir, file)
    const runner = existsSync(path) ? it : it.skip
    runner(`parses ${file} within ${maxMs}ms`, () => {
      const data = readFileSync(path)
      const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      const start = performance.now()
      const result = parseDocFileFromBuffer(buf)
      const elapsed = performance.now() - start
      expect(result.success).toBe(true)
      expect(elapsed).toBeLessThan(maxMs)
      if (minTextLen !== undefined) {
        expect((result.text ?? '').length).toBeGreaterThan(minTextLen)
      }
      if (minTableParas !== undefined) {
        const paragraphs = (result.document as any)?.paragraphs ?? []
        const tableParas = paragraphs.filter((p: any) => p.paraFormat?.table).length
        expect(tableParas).toBeGreaterThanOrEqual(minTableParas)
      }
    })
  }
})
