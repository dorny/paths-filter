import {exec} from '@actions/exec'

export async function fetchCommit(sha: string): Promise<void> {
  const exitCode = await exec('git', ['fetch', '--depth=1', 'origin', sha])
  if (exitCode !== 0) {
    throw new Error(`Fetching commit ${sha} failed`)
  }
}

export async function getChangedFiles(sha: string): Promise<string[]> {
  let output = ''
  const exitCode = await exec('git', ['diff-index', '--name-only', sha], {
    listeners: {
      stdout: (data: Buffer) => (output += data.toString())
    }
  })

  if (exitCode !== 0) {
    throw new Error(`Couldn't determine changed files`)
  }

  return output
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}
