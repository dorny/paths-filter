import {exec} from '@actions/exec'

export async function fetchBranch(base: string): Promise<void> {
  const exitCode = await exec('git', ['fetch', '--depth=1', 'origin', `${base}:refs/head/${base}`])
  if (exitCode !== 0) {
    throw new Error(`Fetching branch ${base} failed, exiting`)
  }
}

export async function getChangedFiles(base: string): Promise<string[]> {
  let output = ''
  const exitCode = await exec('git', ['diff-index', '--name-only', base], {
    listeners: {
      stdout: (data: Buffer) => (output += data.toString())
    }
  })

  if (exitCode !== 0) {
    throw new Error(`Couldn't determine changed files, exiting`)
  }

  return output
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}
