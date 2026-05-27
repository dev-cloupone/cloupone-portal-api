import { describe, it, expect } from 'vitest'
import { escapeLike } from '../escape-like'

describe('escapeLike', () => {
  it('escapes % character', () => {
    expect(escapeLike('100%')).toBe('100\\%')
  })

  it('escapes _ character', () => {
    expect(escapeLike('test_value')).toBe('test\\_value')
  })

  it('escapes \\ character', () => {
    expect(escapeLike('path\\file')).toBe('path\\\\file')
  })

  it('returns string without special characters unchanged', () => {
    expect(escapeLike('hello world')).toBe('hello world')
  })

  it('escapes multiple special characters in the same string', () => {
    expect(escapeLike('50%_test\\')).toBe('50\\%\\_test\\\\')
  })

  it('handles empty string', () => {
    expect(escapeLike('')).toBe('')
  })
})
