import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' }))[0]
const packedFiles = new Set(packed.files.map(({ path }) => path))
const targets = Object.values(manifest.exports).flatMap((entry) =>
  typeof entry === 'string' ? [entry] : Object.values(entry).filter((value) => typeof value === 'string'),
)

for (const target of targets) {
  const file = target.replace(/^\.\//, '')
  assert(existsSync(file), 'Missing package export target: ' + file)
  assert(packedFiles.has(file), 'Package export target is not packed: ' + file)
}

for (const requiredFile of [
  'dist/doc-preview.js',
  'dist/doc-preview.umd.cjs',
  'dist/doc-preview.css',
  'dist/index.d.ts',
]) {
  assert(packedFiles.has(requiredFile), 'Required package file is missing: ' + requiredFile)
}

assert(
  [...packedFiles].some((file) => /^dist\/assets\/docParser\.worker-.*\.js$/.test(file)),
  'Bundled parser Worker is missing from the package',
)

console.log('Verified ' + packed.files.length + ' npm package files and ' + targets.length + ' export targets.')
