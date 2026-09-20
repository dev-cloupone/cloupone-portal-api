import { describe, it, expect } from 'vitest'
import { getPriorityLabel } from '../translations'

describe('getPriorityLabel', () => {
  it('returns pt-BR labels', () => {
    expect(getPriorityLabel('pt-BR', 'low')).toBe('Baixa')
    expect(getPriorityLabel('pt-BR', 'medium')).toBe('Média')
    expect(getPriorityLabel('pt-BR', 'high')).toBe('Alta')
    expect(getPriorityLabel('pt-BR', 'critical')).toBe('Crítica')
  })

  it('returns en-US labels', () => {
    expect(getPriorityLabel('en-US', 'low')).toBe('Low')
    expect(getPriorityLabel('en-US', 'medium')).toBe('Medium')
    expect(getPriorityLabel('en-US', 'high')).toBe('High')
    expect(getPriorityLabel('en-US', 'critical')).toBe('Critical')
  })

  it('falls back to the raw value for an unknown priority', () => {
    expect(getPriorityLabel('pt-BR', 'unknown')).toBe('unknown')
    expect(getPriorityLabel('en-US', 'unknown')).toBe('unknown')
  })
})
