// The look in one place. Theme keys follow the user's Claude Code theme (light or dark).
export const color = {
  dim: 'inactive',
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
  check: '⚠',
  arrow: '→',
  minus: '−',
  dot: '⏺', // Claude Code's own row mark
  elbow: '  ⎿  ', // and the gutter under it
} as const

/** The card's dot by verdict: green, red, amber, gray with no test run, orange while the turn runs. */
export const verdictColor = { pass: color.pass, fail: color.fail, check: color.check, none: color.dim, running: color.accent } as const

/** A tone's theme key. */
export const toneColor = { pass: color.pass, fail: color.fail, check: color.check, accent: color.accent, dim: color.dim, text: color.text } as const
