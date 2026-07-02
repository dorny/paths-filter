import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {exec} from '@actions/exec'
import {
  buildGitEnv,
  cleanup,
  createTempGitHome,
  ensureSafeDirectory,
  getGitEnv,
  isDubiousOwnershipError,
  parseRepositoryPath,
  resolveTempBaseDir
} from '../src/safe-directory'

jest.mock('@actions/exec')

const execMock = exec as jest.MockedFunction<typeof exec>

const DUBIOUS_STDERR = "fatal: detected dubious ownership in repository at '/github/workspace'"
const UNSAFE_STDERR = "fatal: unsafe repository ('/github/workspace' is owned by someone else)"

describe('detection of dubious ownership errors', () => {
  test('detects "detected dubious ownership" wording at exit code 128', () => {
    expect(isDubiousOwnershipError(128, DUBIOUS_STDERR)).toBe(true)
  })

  test('detects older "unsafe repository" wording at exit code 128', () => {
    expect(isDubiousOwnershipError(128, UNSAFE_STDERR)).toBe(true)
  })

  test('does not match other git errors at exit code 128', () => {
    expect(isDubiousOwnershipError(128, 'fatal: not a git repository')).toBe(false)
  })

  test('does not match dubious ownership text at other exit codes', () => {
    expect(isDubiousOwnershipError(1, DUBIOUS_STDERR)).toBe(false)
    expect(isDubiousOwnershipError(0, DUBIOUS_STDERR)).toBe(false)
  })

  test('parseRepositoryPath extracts path from both wordings', () => {
    expect(parseRepositoryPath(DUBIOUS_STDERR)).toBe('/github/workspace')
    expect(parseRepositoryPath(UNSAFE_STDERR)).toBe('/github/workspace')
    expect(parseRepositoryPath('fatal: not a git repository')).toBeUndefined()
  })
})

describe('createTempGitHome', () => {
  const scratchDirs: string[] = []

  async function makeScratchDir(): Promise<string> {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'safe-directory-test-'))
    scratchDirs.push(dir)
    return dir
  }

  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.promises.rm(dir, {recursive: true, force: true})
    }
  })

  test('copies file referenced by GIT_CONFIG_GLOBAL and skips XDG fallback', async () => {
    const base = await makeScratchDir()
    const home = await makeScratchDir()
    const configFile = path.join(home, 'custom-gitconfig')
    await fs.promises.writeFile(configFile, 'custom')
    await fs.promises.mkdir(path.join(home, '.config', 'git'), {recursive: true})
    await fs.promises.writeFile(path.join(home, '.config', 'git', 'config'), 'xdg')

    const tempHome = await createTempGitHome(base, {GIT_CONFIG_GLOBAL: configFile, HOME: home})
    scratchDirs.push(tempHome)

    expect(await fs.promises.readFile(path.join(tempHome, '.gitconfig'), 'utf8')).toBe('custom')
    expect(fs.existsSync(path.join(tempHome, '.config', 'git', 'config'))).toBe(false)
  })

  test('does not throw when GIT_CONFIG_GLOBAL references missing file', async () => {
    const base = await makeScratchDir()

    const tempHome = await createTempGitHome(base, {GIT_CONFIG_GLOBAL: path.join(base, 'missing-gitconfig')})
    scratchDirs.push(tempHome)

    expect(await fs.promises.readFile(path.join(tempHome, '.gitconfig'), 'utf8')).toBe('')
  })

  test('copies $HOME/.gitconfig', async () => {
    const base = await makeScratchDir()
    const home = await makeScratchDir()
    await fs.promises.writeFile(path.join(home, '.gitconfig'), 'home config')

    const tempHome = await createTempGitHome(base, {HOME: home})
    scratchDirs.push(tempHome)

    expect(await fs.promises.readFile(path.join(tempHome, '.gitconfig'), 'utf8')).toBe('home config')
  })

  test('copies XDG fallback config only when XDG_CONFIG_HOME is unset', async () => {
    const base = await makeScratchDir()
    const home = await makeScratchDir()
    await fs.promises.mkdir(path.join(home, '.config', 'git'), {recursive: true})
    await fs.promises.writeFile(path.join(home, '.config', 'git', 'config'), 'xdg config')

    const tempHome = await createTempGitHome(base, {HOME: home})
    scratchDirs.push(tempHome)
    expect(await fs.promises.readFile(path.join(tempHome, '.config', 'git', 'config'), 'utf8')).toBe('xdg config')

    const tempHomeWithXdg = await createTempGitHome(base, {HOME: home, XDG_CONFIG_HOME: path.join(home, '.config')})
    scratchDirs.push(tempHomeWithXdg)
    expect(fs.existsSync(path.join(tempHomeWithXdg, '.config', 'git', 'config'))).toBe(false)
  })

  test('creates an empty .gitconfig even when there is no config to copy', async () => {
    const base = await makeScratchDir()

    const tempHome = await createTempGitHome(base, {})
    scratchDirs.push(tempHome)

    expect(await fs.promises.readdir(tempHome)).toEqual(['.gitconfig'])
    expect(await fs.promises.readFile(path.join(tempHome, '.gitconfig'), 'utf8')).toBe('')
  })
})

describe('buildGitEnv', () => {
  test('overrides HOME and GIT_CONFIG_GLOBAL, preserves other variables, drops undefined values', () => {
    const env = buildGitEnv('/temp/home', {
      HOME: '/root',
      GIT_CONFIG_GLOBAL: '/root/.gitconfig',
      PATH: '/usr/bin',
      UNDEFINED_VALUE: undefined
    })

    expect(env['HOME']).toBe('/temp/home')
    expect(env['GIT_CONFIG_GLOBAL']).toBe(path.join('/temp/home', '.gitconfig'))
    expect(env['PATH']).toBe('/usr/bin')
    expect('UNDEFINED_VALUE' in env).toBe(false)
  })

  test('leaves GIT_CONFIG_GLOBAL unset when not present in the original environment', () => {
    const env = buildGitEnv('/temp/home', {HOME: '/root', PATH: '/usr/bin'})

    expect(env['HOME']).toBe('/temp/home')
    expect('GIT_CONFIG_GLOBAL' in env).toBe(false)
  })
})

describe('resolveTempBaseDir', () => {
  test('prefers RUNNER_TEMP and falls back to os.tmpdir()', () => {
    expect(resolveTempBaseDir({RUNNER_TEMP: '/runner/temp'})).toBe('/runner/temp')
    expect(resolveTempBaseDir({RUNNER_TEMP: ''})).toBe(os.tmpdir())
    expect(resolveTempBaseDir({})).toBe(os.tmpdir())
  })
})

describe('ensureSafeDirectory', () => {
  const envBackup = process.env
  let runnerTemp: string

  beforeEach(async () => {
    runnerTemp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'safe-directory-test-runner-'))
    process.env = {...envBackup}
    process.env['RUNNER_TEMP'] = runnerTemp
    process.env['HOME'] = runnerTemp
    process.env['GITHUB_WORKSPACE'] = process.cwd()
    delete process.env['GIT_CONFIG_GLOBAL']
    delete process.env['XDG_CONFIG_HOME']
  })

  afterEach(async () => {
    await cleanup()
    await fs.promises.rm(runnerTemp, {recursive: true, force: true})
    process.env = envBackup
  })

  test('activates temporary HOME and adds reported directories on first call', async () => {
    expect(getGitEnv()).toBeUndefined()

    const added = await ensureSafeDirectory(DUBIOUS_STDERR)

    expect(added).toBe(true)
    expect(getGitEnv()).toEqual(
      expect.objectContaining({
        HOME: expect.stringContaining('paths-filter-git-home-')
      })
    )
    // GIT_CONFIG_GLOBAL was not set in the original environment, so it must stay unset
    expect(getGitEnv()).not.toHaveProperty('GIT_CONFIG_GLOBAL')
    expect(execMock).toHaveBeenCalledWith(
      'git',
      ['config', '--global', '--add', 'safe.directory', '/github/workspace'],
      expect.objectContaining({
        env: expect.objectContaining({HOME: expect.stringContaining('paths-filter-git-home-')})
      })
    )
    expect(execMock).toHaveBeenCalledWith(
      'git',
      ['config', '--global', '--add', 'safe.directory', process.cwd()],
      expect.anything()
    )
  })

  test('returns false when repeated stderr adds no new directory', async () => {
    await ensureSafeDirectory(DUBIOUS_STDERR)
    const callCount = execMock.mock.calls.length

    const added = await ensureSafeDirectory(DUBIOUS_STDERR)

    expect(added).toBe(false)
    expect(execMock.mock.calls.length).toBe(callCount)
  })

  test('adds directory reported by a later error for a different path', async () => {
    await ensureSafeDirectory(DUBIOUS_STDERR)

    const added = await ensureSafeDirectory("fatal: detected dubious ownership in repository at '/other/repo'")

    expect(added).toBe(true)
    expect(execMock).toHaveBeenCalledWith(
      'git',
      ['config', '--global', '--add', 'safe.directory', '/other/repo'],
      expect.anything()
    )
  })

  test('cleanup removes the temporary HOME and resets state', async () => {
    await ensureSafeDirectory(DUBIOUS_STDERR)
    const tempHome = getGitEnv()?.['HOME']
    expect(tempHome).toBeDefined()

    await cleanup()

    expect(getGitEnv()).toBeUndefined()
    expect(fs.existsSync(tempHome as string)).toBe(false)
  })
})
