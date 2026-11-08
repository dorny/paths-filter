import {getExecOutput, ExecOutput} from '@actions/exec'
import * as core from '@actions/core'
import {context} from '@actions/github'
import {getChanges, gitExec} from '../src/git'
import {ChangeStatus} from '../src/file'
import {cleanup, ensureSafeDirectory, getGitEnv} from '../src/safe-directory'

jest.mock('@actions/exec')
jest.mock('@actions/core')
jest.mock('@actions/github', () => ({context: {eventName: '', ref: '', payload: {}}}))
jest.mock('../src/safe-directory', () => ({
  ...jest.requireActual('../src/safe-directory'),
  cleanup: jest.fn(),
  ensureSafeDirectory: jest.fn(),
  getGitEnv: jest.fn()
}))

const getExecOutputMock = getExecOutput as jest.MockedFunction<typeof getExecOutput>
const ensureSafeDirectoryMock = ensureSafeDirectory as jest.MockedFunction<typeof ensureSafeDirectory>
const getGitEnvMock = getGitEnv as jest.MockedFunction<typeof getGitEnv>

const SUCCESS_OUTPUT: ExecOutput = {exitCode: 0, stdout: 'ok', stderr: ''}
const DUBIOUS_OUTPUT: ExecOutput = {
  exitCode: 128,
  stdout: '',
  stderr: "fatal: detected dubious ownership in repository at '/github/workspace'"
}

// clearMocks in jest.config.js does not remove queued mockResolvedValueOnce values or implementations
beforeEach(() => {
  getExecOutputMock.mockReset()
  ensureSafeDirectoryMock.mockReset()
  getGitEnvMock.mockReset()
  jest.mocked(cleanup).mockReset()
})

describe('gitExec', () => {
  test('returns result of successful command without invoking the workaround', async () => {
    getExecOutputMock.mockResolvedValueOnce(SUCCESS_OUTPUT)

    const result = await gitExec(['status'])

    expect(result).toBe(SUCCESS_OUTPUT)
    expect(getExecOutputMock).toHaveBeenCalledTimes(1)
    expect(getExecOutputMock).toHaveBeenCalledWith('git', ['status'], expect.objectContaining({ignoreReturnCode: true}))
    expect(ensureSafeDirectoryMock).not.toHaveBeenCalled()
  })

  test('passes environment from getGitEnv to git', async () => {
    const env = {HOME: '/temp/home'}
    getGitEnvMock.mockReturnValue(env)
    getExecOutputMock.mockResolvedValueOnce(SUCCESS_OUTPUT)

    await gitExec(['status'])

    expect(getExecOutputMock).toHaveBeenCalledWith('git', ['status'], expect.objectContaining({env}))
  })

  test('retries once after dubious ownership error is worked around', async () => {
    getExecOutputMock.mockResolvedValueOnce(DUBIOUS_OUTPUT).mockResolvedValueOnce(SUCCESS_OUTPUT)
    ensureSafeDirectoryMock.mockResolvedValueOnce(true)

    const result = await gitExec(['status'])

    expect(result).toBe(SUCCESS_OUTPUT)
    expect(ensureSafeDirectoryMock).toHaveBeenCalledWith(DUBIOUS_OUTPUT.stderr)
    expect(getExecOutputMock).toHaveBeenCalledTimes(2)
    for (const call of getExecOutputMock.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ignoreReturnCode: true}))
    }
  })

  test('throws actionable error when retry still fails with dubious ownership', async () => {
    getExecOutputMock.mockResolvedValueOnce(DUBIOUS_OUTPUT).mockResolvedValueOnce(DUBIOUS_OUTPUT)
    ensureSafeDirectoryMock.mockResolvedValueOnce(true)

    const promise = gitExec(['status'])

    await expect(promise).rejects.toThrow(/detected dubious ownership/)
    await expect(promise).rejects.toThrow(/safe\.directory/)
    await expect(promise).rejects.toThrow(/--user/)
    expect(getExecOutputMock).toHaveBeenCalledTimes(2)
  })

  test('throws without retry when workaround adds nothing new', async () => {
    getExecOutputMock.mockResolvedValueOnce(DUBIOUS_OUTPUT)
    ensureSafeDirectoryMock.mockResolvedValueOnce(false)

    await expect(gitExec(['status'])).rejects.toThrow(/safe\.directory/)
    expect(getExecOutputMock).toHaveBeenCalledTimes(1)
  })

  test('returns non-dubious failure when ignoreReturnCode is set', async () => {
    const failure: ExecOutput = {exitCode: 1, stdout: '', stderr: 'some error'}
    getExecOutputMock.mockResolvedValueOnce(failure)

    const result = await gitExec(['show-ref', 'master'], {ignoreReturnCode: true})

    expect(result).toBe(failure)
    expect(ensureSafeDirectoryMock).not.toHaveBeenCalled()
  })

  test('retries dubious ownership error even when ignoreReturnCode is set', async () => {
    getExecOutputMock.mockResolvedValueOnce(DUBIOUS_OUTPUT).mockResolvedValueOnce(SUCCESS_OUTPUT)
    ensureSafeDirectoryMock.mockResolvedValueOnce(true)

    const result = await gitExec(['show-ref', 'master'], {ignoreReturnCode: true})

    expect(result).toBe(SUCCESS_OUTPUT)
    expect(getExecOutputMock).toHaveBeenCalledTimes(2)
  })

  test('throws on non-dubious failure when ignoreReturnCode is not set', async () => {
    getExecOutputMock.mockResolvedValueOnce({exitCode: 1, stdout: '', stderr: 'some error'})

    await expect(gitExec(['fetch'])).rejects.toThrow("The process 'git fetch' failed with exit code 1")
    expect(getExecOutputMock).toHaveBeenCalledTimes(1)
    expect(ensureSafeDirectoryMock).not.toHaveBeenCalled()
  })
})

test.each([
  ['main', 'feature/topic'],
  ['refs/heads/main', 'refs/heads/topic'],
  ['refs/tags/main', 'refs/tags/topic'],
  ['refs/remotes/origin/main', 'refs/remotes/origin/topic']
])('getChanges resolves short names %s and %s', async (base, head) => {
  const outputs: {[command: string]: string} = {
    [`show-ref ${base}`]: `${'a'.repeat(40)} refs/remotes/origin/${base}\n`,
    [`show-ref ${head}`]: `${'b'.repeat(40)} refs/remotes/origin/${head}\n`,
    [`diff --no-renames --name-status -z refs/remotes/origin/${base}..refs/remotes/origin/${head}`]:
      'M\u0000src/app.ts\u0000'
  }
  getExecOutputMock.mockImplementation(async (_command, args) => {
    const stdout = outputs[args?.join(' ') ?? '']
    if (stdout === undefined) {
      throw new Error(`Unexpected git arguments: ${args?.join(' ')}`)
    }
    return {exitCode: 0, stdout, stderr: ''}
  })

  const files = await getChanges(base, head)

  expect(files).toEqual([{filename: 'src/app.ts', status: ChangeStatus.Modified}])
})

test.each(['workflow_dispatch', 'pull_request'])(
  'action preserves canonical branch fallbacks for %s',
  async eventName => {
    const base = 'refs/remotes/origin/main'
    const head = 'refs/remotes/origin/topic'
    context.eventName = eventName
    context.ref = ''
    context.payload = {
      repository: {name: 'fixture', owner: {login: 'local'}, default_branch: base},
      pull_request: {number: 1, base: {}}
    }
    jest.mocked(core.getInput).mockImplementation(name => (name === 'filters' ? 'src: ["src/**"]' : ''))

    const baseRef = `refs/remotes/origin/${base}`
    const headRef = `refs/remotes/origin/${head}`
    const diff = `${baseRef}${eventName === 'pull_request' ? '..' : '...'}${headRef}`
    const outputs: {[command: string]: string} = {
      'rev-parse --abbrev-ref HEAD': `${head}\n`,
      [`show-ref ${base}`]: `${'a'.repeat(40)} ${baseRef}\n`,
      [`show-ref ${head}`]: `${'b'.repeat(40)} ${headRef}\n`,
      [`merge-base ${baseRef} ${headRef}`]: `${'a'.repeat(40)}\n`,
      [`diff --no-renames --name-status -z ${diff}`]: 'M\u0000src/app.ts\u0000'
    }
    getExecOutputMock.mockImplementation(async (_command, args) => {
      const stdout = outputs[args?.join(' ') ?? '']
      if (stdout === undefined) {
        throw new Error(`Unexpected git arguments: ${args?.join(' ')}`)
      }
      return {exitCode: 0, stdout, stderr: ''}
    })

    const completed = new Promise<void>(resolve => {
      jest.mocked(cleanup).mockImplementationOnce(async () => resolve())
    })
    await jest.isolateModulesAsync(async () => {
      await import('../src/main')
      await completed
    })

    expect({errors: jest.mocked(core.setFailed).mock.calls, outputs: jest.mocked(core.setOutput).mock.calls}).toEqual({
      errors: [],
      outputs: [
        ['src', true],
        ['src_count', 1],
        ['changes', '["src"]']
      ]
    })
  }
)
