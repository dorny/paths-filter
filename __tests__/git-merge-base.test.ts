import {getExecOutput, ExecOutput} from '@actions/exec'
import {getChangesSinceMergeBase} from '../src/git'

jest.mock('@actions/exec')
jest.mock('../src/safe-directory', () => ({
  ...jest.requireActual('../src/safe-directory'),
  ensureSafeDirectory: jest.fn(),
  getGitEnv: jest.fn()
}))

const getExecOutputMock = getExecOutput as jest.MockedFunction<typeof getExecOutput>

const BASE = 'master'
const HEAD = 'feature'
const BASE_REF = `refs/remotes/origin/${BASE}`
const HEAD_REF = `refs/remotes/origin/${HEAD}`

const execOutput = (stdout: string, exitCode = 0): ExecOutput => ({exitCode, stdout, stderr: ''})

beforeEach(() => {
  getExecOutputMock.mockReset()
})

describe('deepening while searching for a merge base', () => {
  test('counts commits reachable from base and head only', async () => {
    const revListInvocations: string[][] = []

    getExecOutputMock.mockImplementation(async (_commandLine, args = []) => {
      switch (args[0]) {
        case 'show-ref':
          return execOutput(`0000000000000000000000000000000000000000 refs/remotes/origin/${args[1]}\n`)
        case 'merge-base':
          // Never resolves, so the deepening loop is entered
          return execOutput('', 1)
        case 'rev-list':
          revListInvocations.push([...args])
          // Constant count, so the loop gives up after a single deepen attempt
          return execOutput('42\n')
        default:
          return execOutput('')
      }
    })

    await getChangesSinceMergeBase(BASE, HEAD, 10)

    expect(revListInvocations.length).toBeGreaterThan(0)
    for (const args of revListInvocations) {
      expect(args).toEqual(['rev-list', '--count', BASE_REF, HEAD_REF])
    }
  })
})
