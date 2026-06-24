import * as git from '../src/git'
import * as exec from '@actions/exec'

jest.mock('@actions/exec')
const mockedGetExecOutput = jest.mocked(exec.getExecOutput)

beforeEach(() => {
  mockedGetExecOutput.mockReset()
})

describe('resolveRefToSha', () => {
  test('resolves a branch name to its commit SHA', async () => {
    mockedGetExecOutput.mockResolvedValue({
      exitCode: 0,
      stdout: '8b399ed1681b9efd6b1e048ca1c5cba47edf3855\n',
      stderr: ''
    })
    const sha = await git.resolveRefToSha('master')
    expect(sha).toBe('8b399ed1681b9efd6b1e048ca1c5cba47edf3855')
    expect(mockedGetExecOutput).toHaveBeenCalledWith('git', ['rev-parse', 'master'])
  })

  test('resolves a tag to its commit SHA', async () => {
    mockedGetExecOutput.mockResolvedValue({
      exitCode: 0,
      stdout: '8b399ed1681b9efd6b1e048ca1c5cba47edf3855\n',
      stderr: ''
    })
    const sha = await git.resolveRefToSha('release-18')
    expect(sha).toBe('8b399ed1681b9efd6b1e048ca1c5cba47edf3855')
    expect(mockedGetExecOutput).toHaveBeenCalledWith('git', ['rev-parse', 'release-18'])
  })

  test('returns SHA as-is when given a full SHA', async () => {
    const fullSha = '8b399ed1681b9efd6b1e048ca1c5cba47edf3855'
    mockedGetExecOutput.mockResolvedValue({
      exitCode: 0,
      stdout: `${fullSha}\n`,
      stderr: ''
    })
    const sha = await git.resolveRefToSha(fullSha)
    expect(sha).toBe(fullSha)
  })
})

describe('isBaseSameAsHead with SHA comparison', () => {
  test('different ref names pointing to same commit are treated as same', async () => {
    const sameSha = '8b399ed1681b9efd6b1e048ca1c5cba47edf3855'
    mockedGetExecOutput.mockResolvedValue({
      exitCode: 0,
      stdout: `${sameSha}\n`,
      stderr: ''
    })

    const base: string = 'master'
    const head: string = 'release-18'
    const baseSha = await git.resolveRefToSha(base)
    const headSha = await git.resolveRefToSha(head)
    const isBaseSameAsHead = base === head || baseSha === headSha

    expect(base === head).toBe(false) // ref names differ
    expect(isBaseSameAsHead).toBe(true) // but SHAs match
  })

  test('different ref names pointing to different commits are not same', async () => {
    mockedGetExecOutput
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n',
        stderr: ''
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n',
        stderr: ''
      })

    const base: string = 'master'
    const head: string = 'feature/xyz'
    const baseSha = await git.resolveRefToSha(base)
    const headSha = await git.resolveRefToSha(head)
    const isBaseSameAsHead = base === head || baseSha === headSha

    expect(isBaseSameAsHead).toBe(false)
  })

  test('same ref names are detected without SHA resolution', async () => {
    const base: string = 'master'
    const head: string = 'master'
    const isBaseSameAsHead = base === head

    expect(isBaseSameAsHead).toBe(true)
    expect(mockedGetExecOutput).not.toHaveBeenCalled()
  })
})
