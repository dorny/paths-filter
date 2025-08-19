import {isPredicateQuantifier, SUPPORTED_PREDICATE_QUANTIFIERS} from '../src/filter'

describe('isPredicateQuantifier', () => {
  test('returns true for supported values', () => {
    for (const value of SUPPORTED_PREDICATE_QUANTIFIERS) {
      expect(isPredicateQuantifier(value)).toBe(true)
    }
  })

  test('returns false for unsupported values including sample', () => {
    expect(isPredicateQuantifier('sample')).toBe(false)
    expect(isPredicateQuantifier('')).toBe(false)
    expect(isPredicateQuantifier(undefined)).toBe(false)
  })
})
