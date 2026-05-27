import { describe, it, expect } from 'vitest'
import { sanitizeContent } from '../sanitize'

describe('sanitizeContent', () => {
  it('removes <script> tags', () => {
    expect(sanitizeContent('<script>alert("xss")</script>texto')).toBe('texto')
  })

  it('removes <style> tags', () => {
    expect(sanitizeContent('<style>body{color:red}</style>texto')).toBe('texto')
  })

  it('removes HTML tags (empty whiteList strips all)', () => {
    // With empty whiteList, all tags are stripped
    const result = sanitizeContent('<p>texto <b>bold</b></p>')
    expect(result).not.toContain('<p>')
    expect(result).not.toContain('<b>')
    expect(result).toContain('texto')
    expect(result).toContain('bold')
  })

  it('preserves text without HTML', () => {
    expect(sanitizeContent('texto simples')).toBe('texto simples')
  })

  it('handles empty string', () => {
    expect(sanitizeContent('')).toBe('')
  })
})
