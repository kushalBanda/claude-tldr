// The user's feature switches. Slice 9 adds them to the plugin's settings; until then all are on.
import type { PluginOptions } from 'claude-code'

export type Features = {
  card: boolean
  motion: boolean
  animation: boolean // motion without frames: static colors only
  trust: boolean
  keep: boolean
  actions: boolean // clean copy, diff
  context: boolean // the context bar above the prompt
}

function flag(options: PluginOptions, key: string): boolean {
  return options[key] !== false
}

export function readFeatures(options: PluginOptions): Features {
  const card = flag(options, 'card')
  return { card, motion: flag(options, 'motion'), animation: flag(options, 'animation'), trust: card && flag(options, 'trust'), keep: card && flag(options, 'keep'), actions: card && flag(options, 'actions'), context: flag(options, 'context') }
}
