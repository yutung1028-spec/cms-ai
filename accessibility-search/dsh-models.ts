/**
 * Confirmed 0.2.1-rc.5 mapping. Adapter serializes Messages as
 * `{ model: options.model }` with no rename.
 *
 * Built-in adapter catalog (`DEFAULT_MODELS`): deepseek-flash, deepseek-v4-pro.
 * Official GET /models example and Models & Pricing (api-docs.deepseek.com):
 * the same two ids.
 *
 * SDK README example uses deepseek-v4-flash. Official pricing calls that a
 * retired alias still accepted and billed as Flash. It is not the current
 * catalog id. Display name DeepSeek-V4.1-Flash is not a DSH/API model id.
 */
export const DSH_PROVIDER_ID = 'deepseek-official'
export const DSH_MODEL_ID = 'deepseek-flash'
export const DSH_API_MODEL = 'deepseek-flash'

export const DSH_CATALOG_MODEL_IDS = ['deepseek-flash', 'deepseek-v4-pro'] as const
export const DSH_LEGACY_FLASH_ALIASES = ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'] as const
