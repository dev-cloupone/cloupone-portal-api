import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * `phase.routes.ts` faz `router.use(auth, ...)` e e montado na raiz `/api`. Em
 * Express, um `router.use()` roda em TODA requisicao sob o prefixo de montagem,
 * mesmo quando nenhuma rota daquele router casa com o caminho — ou seja, aquele
 * `auth` intercepta todo o /api.
 *
 * O stream SSE autentica por query string (`sseAuth`), porque a API EventSource
 * do browser nao permite enviar header Authorization. Se o mount de
 * `/api/notifications` cair depois do mount de `/api`, o stream leva 401
 * (MIDDLEWARE_AUTH_REQUIRED) antes de chegar ao proprio middleware — e o sino
 * silencia sem nenhum erro de servidor. Foi exatamente essa a regressao ao
 * remover o fallback de `?token=` do middleware `auth` global.
 */

const server = fs.readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf-8')

function mountIndex(pattern: string): number {
  const index = server.indexOf(pattern)
  expect(index, `mount nao encontrado em server.ts: ${pattern}`).toBeGreaterThan(-1)
  return index
}

describe('ordem de montagem das rotas', () => {
  it('monta /api/notifications antes de qualquer router na raiz /api', () => {
    const notifications = mountIndex("app.use('/api/notifications'")
    const apiRoot = mountIndex("app.use('/api', phaseRoutes)")

    expect(notifications).toBeLessThan(apiRoot)
  })

  it('nao existe outro router montado na raiz /api antes das notificacoes', () => {
    const notifications = mountIndex("app.use('/api/notifications'")
    const rootMounts = [...server.matchAll(/app\.use\('\/api',\s*(\w+)\)/g)]

    expect(rootMounts.length).toBeGreaterThan(0)
    for (const match of rootMounts) {
      expect(
        match.index,
        `${match[1]} esta montado na raiz /api antes de /api/notifications e vai interceptar o stream SSE`,
      ).toBeGreaterThan(notifications)
    }
  })
})
