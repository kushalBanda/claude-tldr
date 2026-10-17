// The look in one place. Theme keys follow the user's Claude Code theme (light or dark).
export const color = {
  border: 'inactive',
  dim: 'inactive',
  label: 'subtle',
  text: 'text',
  accent: 'claude',
  added: 'success',
  removed: 'error',
  pass: 'success',
  fail: 'error',
  check: 'warning',
} as const

export const glyph = {
  pass: '✓',
  fail: '✗',
  arrow: '→',
  expand: '▸',
  collapse: '▾',
  minus: '−',
} as const

export const LABEL_WIDTH = 10 // "Looked at " — keeps the row values aligned
