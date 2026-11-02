import { writeFileSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { callParentTool } from '../ipc-client.js'

export const name = 'accessibility-poi-tools'
export const inject = ['tools', 'systemPrompt']

const ALLOWED_TOOLS = ['get_poi', 'search_pois']
const PROMPT_SECTION = 'accessibility-poi-query'
const POI_QUERY_INSTRUCTIONS = [
  'POI fact lookup rules:',
  '- Before answering Occupant or Amenity facts, call search_pois or get_poi.',
  '- The initial user prompt listing no POIs does not mean the database is empty.',
  '- Do not answer 資料未記錄 or invent records before a successful tool query.',
  '- 可達 maps only to accessibilityStatus=accessible. Do not also require disabledFacilitiesStatus=available.',
  '- If a tool fails, report query failure. Do not treat failure as zero rows.',
  '- Zero rows means no matching records. unknown fields or missing checked time are 未記錄, not missing rows.',
].join('\n')

function jsonTool(name, description, parameters) {
  return defineTool({
    name,
    description,
    parameters,
    output: {
      schema: { type: 'string' },
      render(_args, value) {
        return [{ type: 'text', text: value }]
      },
    },
    async execute(args, exec) {
      const result = await callParentTool(name, args, exec.signal)
      return JSON.stringify(result)
    },
  })
}

function sameNames(names) {
  return (
    names.length === ALLOWED_TOOLS.length &&
    ALLOWED_TOOLS.every(name => names.includes(name))
  )
}

function schemaSummary(schema) {
  const parameters = schema.parameters && typeof schema.parameters === 'object' ? schema.parameters : {}
  const propertiesObject =
    parameters.properties && typeof parameters.properties === 'object' ? parameters.properties : parameters
  const propertyNames = Object.keys(propertiesObject).filter(
    key => !['type', 'required', 'additionalProperties', 'properties', '$schema'].includes(key)
  )
  const requiredFromObject = Object.entries(propertiesObject)
    .filter(([, value]) => value && typeof value === 'object' && value.required === true)
    .map(([key]) => key)
  const required = Array.isArray(parameters.required) ? parameters.required : requiredFromObject
  return {
    name: schema.name,
    description: typeof schema.description === 'string' ? schema.description : '',
    required: [...required].sort(),
    propertyNames: propertyNames.sort(),
  }
}

export function apply(ctx) {
  const dumpPath = process.env.ACCESSIBILITY_TOOL_MANIFEST_PATH
  const dump = payload => {
    if (!dumpPath) return
    writeFileSync(dumpPath, JSON.stringify(payload, null, 2))
  }

  try {
    ctx.tools.register(
      jsonTool(
        'search_pois',
        'Search Occupant and Amenity rows in the Keystone database. The user prompt does not list records; call this or get_poi before answering facts. Optional filters: query, type (occupant|amenity), accessibilityStatus, disabledFacilitiesStatus, notesKeyword, checkedBefore, uncheckedOnly, take, skip. 可達 maps only to accessibilityStatus=accessible; do not require disabledFacilitiesStatus=available. Read-only.',
        {
          query: { type: 'string', description: 'Name or nickname substring' },
          type: { type: 'string', description: 'occupant or amenity' },
          disabledFacilitiesStatus: { type: 'string', description: 'available, unavailable, or unknown' },
          accessibilityStatus: {
            type: 'string',
            description: 'accessible, partially_accessible, inaccessible, or unknown',
          },
          notesKeyword: { type: 'string' },
          checkedBefore: { type: 'string' },
          uncheckedOnly: { type: 'boolean' },
          take: { type: 'number' },
          skip: { type: 'number' },
        }
      )
    )
    ctx.tools.register(
      jsonTool(
        'get_poi',
        'Fetch one Occupant or Amenity by type and id from the database. Required: type, id. Use after search_pois or when the id is known. Read-only.',
        {
          type: { type: 'string', required: true, description: 'occupant or amenity' },
          id: { type: 'string', required: true, description: 'Record id' },
        }
      )
    )

    ctx.tools.guard(exec => {
      if (!ALLOWED_TOOLS.includes(exec.name)) return 'Only search_pois and get_poi are allowed'
    })

    ctx.on('agent/created', ({ agent }) => {
      try {
        agent.ctx.tools.restrict({ allow: ['search_pois', 'get_poi'] })
        agent.ctx.systemPrompt.section({
          name: PROMPT_SECTION,
          order: 50,
          interpolate: false,
          text: POI_QUERY_INSTRUCTIONS,
        })
      } catch (error) {
        dump({
          names: [],
          restrictError: error instanceof Error ? error.message : String(error),
          scope: 'agent',
          failClosed: true,
          promptSection: null,
        })
        throw error
      }
      const schemas = agent.ctx.tools.schemas()
      const names = schemas.map(schema => schema.name).sort()
      if (!sameNames(names)) {
        dump({
          names,
          restrictError: 'agent tool list is not exactly search_pois and get_poi',
          scope: 'agent',
          failClosed: true,
          promptSection: null,
          tools: schemas.map(schemaSummary),
        })
        throw new Error(`Unexpected agent tools: ${names.join(', ')}`)
      }
      dump({
        names,
        restrictError: null,
        scope: 'agent',
        phase: 'agent-created',
        failClosed: false,
        promptSection: PROMPT_SECTION,
        tools: schemas.map(schemaSummary),
      })
    })

    dump({
      names: ctx.tools.schemas().map(schema => schema.name).sort(),
      restrictError: null,
      phase: 'apply',
      tools: ctx.tools.schemas().map(schemaSummary),
      promptSection: null,
    })
  } catch (error) {
    dump({
      names: [],
      restrictError: null,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
