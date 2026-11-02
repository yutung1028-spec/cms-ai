import type { PoiListType } from './validate-args.ts'

const LIST_PATHS: Record<PoiListType, string> = {
  occupant: 'occupants',
  amenity: 'amenities',
}

export function adminPoiItemPath(type: PoiListType, id: string): string {
  return `/${LIST_PATHS[type]}/${encodeURIComponent(id)}`
}
