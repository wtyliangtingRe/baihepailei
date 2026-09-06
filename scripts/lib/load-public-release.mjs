import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname, resolve } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

// Exercise the real TypeScript runtime outside Next without loading server-only.
// Each invocation has its own global cache, which permits baseline comparisons.
export function loadPublicRelease(root, overrides = {}) {
  return loadPublicModule(root, 'src/lib/publicRelease.ts', overrides)
}

export function loadPublicModule(root, entry, overrides = {}) {
  const modules = new Map()
  const context = vm.createContext({ process, URL, URLSearchParams, console })
  const nativeRequire = createRequire(join(root, 'package.json'))
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    const module = { exports: {} }; modules.set(path, module)
    const code = overrides[path] ?? readFileSync(path, 'utf8')
    const output = ts.transpileModule(code, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText
    function require(specifier) {
      if (specifier === 'server-only') return {}
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return nativeRequire(specifier)
      let target = specifier.startsWith('@/') ? join(root, 'src', specifier.slice(2)) : resolve(dirname(path), specifier)
      if (!existsSync(target)) target += '.ts'
      return load(target)
    }
    const run = vm.runInContext(`(function(require,module,exports){${output}\n})`, context, { filename:path })
    run(require, module, module.exports)
    return module.exports
  }
  return load(join(root, entry))
}
