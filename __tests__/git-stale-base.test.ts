import {execFileSync} from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {getChangesSinceMergeBase} from '../src/git'

// Uses real git repositories: "origin" plus a clone that keeps an outdated origin/main,
// like a self-hosted runner that keeps .git between jobs
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: os.devNull
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {cwd, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim()
}

function commitFile(cwd: string, name: string): void {
  fs.writeFileSync(path.join(cwd, name), name)
  git(cwd, 'add', name)
  git(cwd, 'commit', '-q', '--no-gpg-sign', '-m', name)
}

describe('getChangesSinceMergeBase with an outdated local base branch', () => {
  let tmpDir: string
  let originDir: string
  const originalCwd = process.cwd()

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paths-filter-'))
    originDir = path.join(tmpDir, 'origin')
    fs.mkdirSync(originDir)
    git(originDir, 'init', '-q', '-b', 'main')
    commitFile(originDir, 'first.txt')
    commitFile(originDir, 'second.txt')
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tmpDir, {recursive: true, force: true})
  })

  // After the clone, main moves on and a feature branch is created from the new main
  function advanceOrigin(): void {
    commitFile(originDir, 'merged-to-main.txt')
    git(originDir, 'checkout', '-q', '-b', 'feature')
    commitFile(originDir, 'feature.txt')
    git(originDir, 'checkout', '-q', 'main')
  }

  function checkoutFeature(cloneDir: string): void {
    git(cloneDir, 'fetch', '-q', 'origin', '+refs/heads/feature:refs/remotes/origin/feature')
    git(cloneDir, 'checkout', '-q', '-b', 'feature', 'origin/feature')
    process.chdir(cloneDir)
  }

  test('compares against the current base branch in a full clone', async () => {
    const cloneDir = path.join(tmpDir, 'clone')
    git(tmpDir, 'clone', '-q', `file://${originDir}`, cloneDir)
    advanceOrigin()
    checkoutFeature(cloneDir)

    const files = await getChangesSinceMergeBase('main', 'feature', 10)

    expect(files.map(f => f.filename)).toEqual(['feature.txt'])
    expect(git(cloneDir, 'rev-parse', 'origin/main')).toBe(git(originDir, 'rev-parse', 'main'))
    expect(git(cloneDir, 'rev-parse', '--is-shallow-repository')).toBe('false')
  })

  test('compares against the current base branch in a shallow clone', async () => {
    const cloneDir = path.join(tmpDir, 'clone')
    git(tmpDir, 'clone', '-q', '--no-single-branch', '--depth=10', `file://${originDir}`, cloneDir)
    advanceOrigin()
    checkoutFeature(cloneDir)

    const files = await getChangesSinceMergeBase('main', 'feature', 10)

    expect(files.map(f => f.filename)).toEqual(['feature.txt'])
    expect(git(cloneDir, 'rev-parse', 'origin/main')).toBe(git(originDir, 'rev-parse', 'main'))
  })
})
