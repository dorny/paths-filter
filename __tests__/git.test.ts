import * as git from '../src/git'
import {ExecOptions} from '@actions/exec'
import {ChangeStatus} from '../src/file'

describe('parsing of the git diff-index command', () => {
  test('getChangedFiles returns files with correct change status', async () => {
    const files = await git.getChangedFiles(git.FETCH_HEAD, (cmd, args, opts) => {
      const stdout = opts?.listeners?.stdout
      if (stdout) {
        stdout(Buffer.from('A       LICENSE\n'))
        stdout(Buffer.from('M       src/index.ts\n'))
        stdout(Buffer.from('D       src/main.ts\n\n'))
      }
      return Promise.resolve(0)
    })
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
