import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as core from '@actions/core'
import {exec} from '@actions/exec'

// Git >= 2.35.2 and distro backports of CVE-2022-24765 fail with exit code 128 when
// the repository is owned by a different user - typical for container jobs where the
// workspace is bind-mounted from the host. Older backports use the "unsafe repository" wording.
const DUBIOUS_OWNERSHIP_PATTERN = /detected dubious ownership|unsafe repository/
const REPOSITORY_PATH_PATTERN = /(?:repository at|unsafe repository \()\s*'([^']+)'/

let tempHomeDir: string | undefined
let gitEnv: {[key: string]: string} | undefined
const safeDirectories = new Set<string>()

export function isDubiousOwnershipError(exitCode: number, stderr: string): boolean {
  return exitCode === 128 && DUBIOUS_OWNERSHIP_PATTERN.test(stderr)
}

export function parseRepositoryPath(stderr: string): string | undefined {
  return stderr.match(REPOSITORY_PATH_PATTERN)?.[1]
}

// Returns undefined until the workaround is activated - git commands of currently
// working users keep inheriting process.env unchanged.
export function getGitEnv(): {[key: string]: string} | undefined {
  return gitEnv
}

// Marks directories reported by git as safe, using a temporary HOME so no configuration
// outside this action is modified - same technique as actions/checkout.
// Returns false if there was no new directory to add.
export async function ensureSafeDirectory(stderr: string): Promise<boolean> {
  if (tempHomeDir === undefined) {
    tempHomeDir = await createTempGitHome(resolveTempBaseDir(process.env), process.env)
    gitEnv = buildGitEnv(tempHomeDir, process.env)
    core.info(
      'Git reported dubious ownership of the repository - this is typical for container jobs ' +
        'where the workspace is owned by a different user. A temporary HOME with a copy of the global ' +
        'git config and a safe.directory exception will be used for git commands executed by this action.'
    )
  }

  let added = false
  for (const dir of [parseRepositoryPath(stderr), process.env.GITHUB_WORKSPACE, process.cwd()]) {
    if (dir && !safeDirectories.has(dir)) {
      await exec('git', ['config', '--global', '--add', 'safe.directory', dir], {env: gitEnv})
      safeDirectories.add(dir)
      added = true
    }
  }
  return added
}

export async function cleanup(): Promise<void> {
  if (tempHomeDir !== undefined) {
    try {
      await fs.promises.rm(tempHomeDir, {recursive: true, force: true})
    } catch (error) {
      // Cleanup failure is not fatal - RUNNER_TEMP is wiped when the job ends
    }
  }
  tempHomeDir = undefined
  gitEnv = undefined
  safeDirectories.clear()
}

// Exported for tests
export async function createTempGitHome(
  baseTempDir: string,
  env: {[key: string]: string | undefined}
): Promise<string> {
  const tempHome = await fs.promises.mkdtemp(path.join(baseTempDir, 'paths-filter-git-home-'))
  const tempConfigPath = path.join(tempHome, '.gitconfig')
  // The file must exist even when there is no config to copy - when $HOME/.gitconfig is missing,
  // `git config --global` writes to an existing $XDG_CONFIG_HOME/git/config instead
  await fs.promises.writeFile(tempConfigPath, '')

  if (env.GIT_CONFIG_GLOBAL) {
    await copyFileIfExists(env.GIT_CONFIG_GLOBAL, tempConfigPath)
  } else if (env.HOME) {
    await copyFileIfExists(path.join(env.HOME, '.gitconfig'), tempConfigPath)
    if (!env.XDG_CONFIG_HOME) {
      // When XDG_CONFIG_HOME is unset, git falls back to $HOME/.config/git/config,
      // which would become unreadable under the new HOME
      await copyFileIfExists(
        path.join(env.HOME, '.config', 'git', 'config'),
        path.join(tempHome, '.config', 'git', 'config')
      )
    }
  }

  return tempHome
}

// Exported for tests
export function buildGitEnv(tempHome: string, env: {[key: string]: string | undefined}): {[key: string]: string} {
  const newEnv: {[key: string]: string} = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      newEnv[key] = value
    }
  }
  // A changed HOME redirects git of any version to the temp config. GIT_CONFIG_GLOBAL is redirected
  // only when already set - on git >= 2.32 it replaces both global config files, so setting it
  // unconditionally would hide an existing $XDG_CONFIG_HOME/git/config from git
  newEnv['HOME'] = tempHome
  if (env.GIT_CONFIG_GLOBAL) {
    newEnv['GIT_CONFIG_GLOBAL'] = path.join(tempHome, '.gitconfig')
  }
  return newEnv
}

// Exported for tests
export function resolveTempBaseDir(env: {[key: string]: string | undefined}): string {
  return env.RUNNER_TEMP || os.tmpdir()
}

async function copyFileIfExists(source: string, destination: string): Promise<void> {
  try {
    await fs.promises.access(source, fs.constants.R_OK)
  } catch (error) {
    return
  }
  await fs.promises.mkdir(path.dirname(destination), {recursive: true})
  await fs.promises.copyFile(source, destination)
}
