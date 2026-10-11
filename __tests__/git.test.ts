import * as git from '../src/git'
import {ChangeStatus} from '../src/file'

describe('parsing output of the git diff command', () => {
  test('parseGitDiffOutput returns files with correct change status', async () => {
    const files = git.parseGitDiffOutput(
      'A\u0000LICENSE\u0000' + 'M\u0000src/index.ts\u0000' + 'D\u0000src/main.ts\u0000'
    )
    expect(files.length).toBe(3)
    expect(files[0].filename).toBe('LICENSE')
    expect(files[0].status).toBe(ChangeStatus.Added)
    expect(files[1].filename).toBe('src/index.ts')
    expect(files[1].status).toBe(ChangeStatus.Modified)
    expect(files[2].filename).toBe('src/main.ts')
    expect(files[2].status).toBe(ChangeStatus.Deleted)
  })
})

describe('git utility function tests (those not invoking git)', () => {
  test('Trims "refs/" and "heads/" from ref', () => {
    expect(git.getShortName('refs/heads/master')).toBe('master')
    expect(git.getShortName('heads/master')).toBe('heads/master')
    expect(git.getShortName('master')).toBe('master')

    expect(git.getShortName('refs/tags/v1')).toBe('v1')
    expect(git.getShortName('tags/v1')).toBe('tags/v1')
    expect(git.getShortName('v1')).toBe('v1')
  })

  test.each([40, 64])('recognises full %i-character commit hashes and null hashes', length => {
    expect(git.isGitSha('0123456789abcdef'.repeat(4).slice(0, length))).toBe(true)
    expect(git.isGitSha('0'.repeat(length))).toBe(true)
    expect(git.isGitNullSha('0'.repeat(length))).toBe(true)
    expect(git.isGitNullSha('0'.repeat(length - 1) + '1')).toBe(false)
  })

  test.each([
    '',
    'master',
    'This_is_very_long_name_for_a_branch_1111',
    'a'.repeat(39),
    'a'.repeat(41),
    'a'.repeat(63),
    'a'.repeat(65),
    'g'.repeat(40),
    'g'.repeat(64),
    'A'.repeat(40),
    'A'.repeat(64),
    '0'.repeat(39),
    '0'.repeat(41),
    '0'.repeat(63),
    '0'.repeat(65)
  ])('rejects invalid full commit and null hashes: %s', ref => {
    expect(git.isGitSha(ref)).toBe(false)
    expect(git.isGitNullSha(ref)).toBe(false)
  })
})
