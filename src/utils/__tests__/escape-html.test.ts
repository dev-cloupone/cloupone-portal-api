import { describe, it, expect } from 'vitest'
import { escapeHtml } from '../escape-html'

describe('escapeHtml', () => {
  it('escapes & to &amp;', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })

  it('escapes < to &lt;', () => {
    expect(escapeHtml('a < b')).toBe('a &lt; b')
  })

  it('escapes > to &gt;', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b')
  })

  it('escapes " to &quot;', () => {
    expect(escapeHtml('a "b" c')).toBe('a &quot;b&quot; c')
  })

  it("escapes ' to &#39;", () => {
    expect(escapeHtml("a 'b' c")).toBe('a &#39;b&#39; c')
  })

  it('returns text without special characters unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world')
  })

  it('escapes multiple characters in the same string', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    )
  })
})
