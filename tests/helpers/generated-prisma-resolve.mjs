import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier.startsWith('.') &&
    context.parentURL?.includes('/generated/prisma/') &&
    !specifier.endsWith('.ts') &&
    !specifier.endsWith('.js') &&
    !specifier.endsWith('.mjs')
  ) {
    const parentDir = dirname(fileURLToPath(context.parentURL))
    if (existsSync(join(parentDir, `${specifier}.ts`))) {
      return nextResolve(`${specifier}.ts`, context)
    }
  }
  return nextResolve(specifier, context)
}
