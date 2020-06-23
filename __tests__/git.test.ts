import * as git from '../src/git'

describe('git utility function tests (those not invoking git)', () => {
  test('Detects if ref references a tag', () => {
    expect(git.isTagRef('refs/tags/v1.0')).toBeTruthy()
    expect(git.isTagRef('refs/heads/master')).toBeFalsy()
    expect(git.isTagRef('master')).toBeFalsy()
  })
  test('Trims "refs/" from ref', () => {
    expect(git.trimRefs('refs/heads/master')).toBe('heads/master')
    expect(git.trimRefs('heads/master')).toBe('heads/master')
    expect(git.trimRefs('master')).toBe('master')
  })
  test('Trims "refs/" and "heads/" from ref', () => {
    expect(git.trimRefsHeads('refs/heads/master')).toBe('master')
    expect(git.trimRefsHeads('heads/master')).toBe('master')
    expect(git.trimRefsHeads('master')).toBe('master')
  })
})
