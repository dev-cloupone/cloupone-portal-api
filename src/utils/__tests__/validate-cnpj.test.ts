import { describe, it, expect } from 'vitest'
import { validateCnpj } from '../validate-cnpj'

describe('validateCnpj', () => {
  it('returns true for valid formatted CNPJ (XX.XXX.XXX/XXXX-XX)', () => {
    expect(validateCnpj('11.222.333/0001-81')).toBe(true)
  })

  it('returns true for valid unformatted CNPJ (14 digits)', () => {
    expect(validateCnpj('11222333000181')).toBe(true)
  })

  it('returns false for CNPJ with all identical digits (11.111.111/1111-11)', () => {
    expect(validateCnpj('11.111.111/1111-11')).toBe(false)
    expect(validateCnpj('00000000000000')).toBe(false)
    expect(validateCnpj('99999999999999')).toBe(false)
  })

  it('returns false for CNPJ with fewer than 14 digits', () => {
    expect(validateCnpj('1122233300018')).toBe(false)
    expect(validateCnpj('123')).toBe(false)
  })

  it('returns false for CNPJ with more than 14 digits', () => {
    expect(validateCnpj('112223330001811')).toBe(false)
  })

  it('returns false for CNPJ with invalid first check digit', () => {
    // CNPJ valido: 11222333000181 — trocar d1 (8→9)
    expect(validateCnpj('11222333000191')).toBe(false)
  })

  it('returns false for CNPJ with invalid second check digit', () => {
    // CNPJ valido: 11222333000181 — trocar d2 (1→2)
    expect(validateCnpj('11222333000182')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(validateCnpj('')).toBe(false)
  })

  it('returns false for string containing letters', () => {
    expect(validateCnpj('abcdefghijklmn')).toBe(false)
    expect(validateCnpj('11.222.333/ABCD-EF')).toBe(false)
  })
})
