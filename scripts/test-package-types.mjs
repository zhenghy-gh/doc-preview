import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const tempRoot = mkdtempSync(join(tmpdir(), 'doc-preview-package-types-'))

const esmSource = [
  "import DocPreview, { DocPreview as NamedDocPreview, DocParser, enableDebugMode, parseDocFileFromBuffer, type ParseResult, type ParsedDocument } from '@zhenghy/doc-preview'",
  'type IsAny<T> = 0 extends (1 & T) ? true : false',
  'type AssertNotAny<T> = IsAny<T> extends true ? never : true',
  'const componentIsTyped: AssertNotAny<typeof DocPreview> = true',
  'const namedComponentIsTyped: AssertNotAny<typeof NamedDocPreview> = true',
  'const parserIsTyped: AssertNotAny<typeof DocParser> = true',
  'const parseFunctionIsTyped: AssertNotAny<typeof parseDocFileFromBuffer> = true',
  'const parseResultIsTyped: AssertNotAny<ParseResult> = true',
  'const parsedDocumentIsTyped: AssertNotAny<ParsedDocument> = true',
  'const documentTitle: string | undefined = ({} as ParsedDocument).properties?.title',
  '// @ts-expect-error ParseResult must not degrade to any',
  'const invalidResult: ParseResult = 123',
  '// @ts-expect-error document title is a string, not a number',
  'const invalidTitle: number = ({} as ParsedDocument).properties?.title',
  'const debugMode: void = enableDebugMode()',
  'void [componentIsTyped, namedComponentIsTyped, parserIsTyped, parseFunctionIsTyped, parseResultIsTyped, parsedDocumentIsTyped, documentTitle, invalidResult, invalidTitle, debugMode]',
].join('\n')

const cjsSource = [
  "import { DocPreview, DocParser, enableDebugMode, parseDocFileFromBuffer, type ParseResult, type ParsedDocument } from '@zhenghy/doc-preview'",
  'type IsAny<T> = 0 extends (1 & T) ? true : false',
  'type AssertNotAny<T> = IsAny<T> extends true ? never : true',
  'const componentIsTyped: AssertNotAny<typeof DocPreview> = true',
  'const parserIsTyped: AssertNotAny<typeof DocParser> = true',
  'const parseFunctionIsTyped: AssertNotAny<typeof parseDocFileFromBuffer> = true',
  'const parseResultIsTyped: AssertNotAny<ParseResult> = true',
  'const parsedDocumentIsTyped: AssertNotAny<ParsedDocument> = true',
  'const documentTitle: string | undefined = ({} as ParsedDocument).properties?.title',
  '// @ts-expect-error ParseResult must not degrade to any',
  'const invalidResult: ParseResult = 123',
  '// @ts-expect-error document title is a string, not a number',
  'const invalidTitle: number = ({} as ParsedDocument).properties?.title',
  'const debugMode: void = enableDebugMode()',
  'void [componentIsTyped, parserIsTyped, parseFunctionIsTyped, parseResultIsTyped, parsedDocumentIsTyped, documentTitle, invalidResult, invalidTitle, debugMode]',
].join('\n')

const consumerCases = [
  { name: 'node16-esm', source: esmSource, filename: 'consumer.mts', module: 'Node16', moduleResolution: 'Node16' },
  { name: 'node16-cjs', source: cjsSource, filename: 'consumer.cts', module: 'Node16', moduleResolution: 'Node16' },
  { name: 'nodenext-esm', source: esmSource, filename: 'consumer.mts', module: 'NodeNext', moduleResolution: 'NodeNext' },
  { name: 'nodenext-cjs', source: cjsSource, filename: 'consumer.cts', module: 'NodeNext', moduleResolution: 'NodeNext' },
  { name: 'bundler-esm', source: esmSource, filename: 'consumer.mts', module: 'ESNext', moduleResolution: 'Bundler' },
]

try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--pack-destination', tempRoot, '--json'], {
    cwd: root,
    encoding: 'utf8',
  }))[0]
  const consumerRoot = join(tempRoot, 'consumer')
  const nodeModules = join(consumerRoot, 'node_modules')
  const packagePath = join(nodeModules, '@zhenghy', 'doc-preview')
  mkdirSync(packagePath, { recursive: true })
  execFileSync('tar', ['-xzf', join(tempRoot, packed.filename), '-C', packagePath, '--strip-components=1'])
  symlinkSync(resolve(root, 'node_modules/vue'), join(nodeModules, 'vue'), process.platform === 'win32' ? 'junction' : 'dir')

  const compiler = resolve(root, 'node_modules/typescript/bin/tsc')
  for (const testCase of consumerCases) {
    const sourcePath = join(consumerRoot, testCase.filename)
    writeFileSync(sourcePath, testCase.source)
    for (const skipLibCheck of [false, true]) {
      const configPath = join(consumerRoot, testCase.name + '-' + skipLibCheck + '.json')
      writeFileSync(configPath, JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: testCase.module,
          moduleResolution: testCase.moduleResolution,
          strict: true,
          noEmit: true,
          skipLibCheck,
          types: [],
        },
        files: [testCase.filename],
      }, null, 2))
      try {
        execFileSync(process.execPath, [compiler, '-p', configPath], { cwd: consumerRoot, stdio: 'pipe' })
      } catch (error) {
        const output = [error.stdout, error.stderr].filter(Boolean).map(String).join('\n')
        throw new Error(testCase.name + ' with skipLibCheck=' + skipLibCheck + ' failed:\n' + output)
      }
    }
  }

  console.log('Verified packed ESM/CJS declarations with Node16, NodeNext, and Bundler resolution (skipLibCheck on/off).')
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
