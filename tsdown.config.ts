/**
 * Self-contained build for both faces of the plugin.
 *
 * The browser face is the DSH client closure factory: a CJS bundle wrapped in
 * `window.__ModuleLoader__.load({ id, factory })`, resolving shared values
 * through the injected `require` (the shell's module table). This is a
 * standalone copy of the in-repo `packages/client/tsdown.client.ts` preset,
 * which cannot be imported from outside the DSH workspace.
 *
 * @module dsh-antigravity/tsdown.config
 */
import { defineConfig } from 'tsdown'

/** The module id the shell registers this plugin's client half under. */
const ID = 'dsh-antigravity'

/** Module-table specifiers every dynamic client bundle may require. */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/** Open the client closure the module table calls back into. */
function registration(): string {
  return `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`
}

export default defineConfig([
  {
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    deps: { neverBundle: ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-client-connection'] },
    dts: false,
    clean: false,
    outputOptions: { entryFileNames: 'index.js' },
  },
  {
    entry: ['src/client/index.ts'],
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    deps: { neverBundle: PLATFORM_MODULES },
    dts: false,
    clean: false,
    outputOptions: {
      entryFileNames: 'client.js',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      banner: (): string => registration(),
      footer: 'return module.exports; } });',
    },
  },
])
