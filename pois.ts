import type { IncomingMessage, ServerResponse } from 'node:http'
import type { KeystoneContext } from '@keystone-6/core/types'

type ExpressLike = {
  get: (
    path: string,
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  ) => void
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

export function registerPoisApi(app: ExpressLike, commonContext: KeystoneContext) {
  app.get('/pois', async (req, res) => {
    try {
      const context = await commonContext.withRequest(req, res)
      const occupants = await context.query.Occupant.findMany({
        query: 'id name nickname address lnglat',
      })

      sendJson(res, 200, {
        pois: occupants.map(occupant => ({
          id: occupant.id,
          occupant: {
            name: occupant.name,
            nickname: occupant.nickname,
            address: occupant.address,
            coordinates: occupant.lnglat ?? null,
          },
        })),
      })
    } catch (error) {
      console.error('GET /pois failed:', error)
      sendJson(res, 500, { error: 'Failed to load POIs' })
    }
  })
}
