import {getExecOutput, ExecOutput} from '@actions/exec'
import {gitExec} from '../src/git'
import {ensureSafeDirectory, getGitEnv} from '../src/safe-directory'

jest.mock('@actions/exec')
jest.mock('../src/safe-directory', () => ({
  ...jest.requireActual('../src/safe-directory'),
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
