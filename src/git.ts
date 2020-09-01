import {exec} from '@actions/exec'
import * as core from '@actions/core'
import {File, ChangeStatus} from './file'

export const NULL_SHA = '0000000000000000000000000000000000000000'

export async function getChangesAgainstSha(sha: string): Promise<File[]> {
  // Fetch single commit
  await exec('git', ['fetch', '--depth=1', '--no-tags', 'origin', sha])

  // Get differences between sha and HEAD
  let output = ''
  try {
    await exec('git', ['diff', '--no-renames', '--name-status', '-z', `${sha}..HEAD`], {
      listeners: {
        stdout: (data: Buffer) => (output += data.toString())
      }
    })
  } finally {
    fixStdOutNullTermination()
  }

  return parseGitDiffOutput(output)
}

export async function getChangesSinceRef(ref: string, initialFetchDepth = 10): Promise<File[]> {
  // Fetch and add base branch
  await exec('git', ['fetch', `--depth=${initialFetchDepth}`, '--no-tags', 'origin', `${ref}:${ref}`])

  // Try to do `git diff`
  // Deepen the history if no merge base is found
  let deepen = initialFetchDepth
  for (;;) {
    let output = ''
    let error = ''
    let exitCode
    try {
      exitCode = await exec('git', ['diff', '--no-renames', '--name-status', '-z', `${ref}...HEAD`], {
        ignoreReturnCode: true,
        listeners: {
          stdout: (data: Buffer) => (output += data.toString()),
          stderr: (data: Buffer) => (error += data.toString())
        }
      })
    } finally {
      fixStdOutNullTermination()
    }

    if (exitCode === 0) {
      return parseGitDiffOutput(output)
    }

    // Only acceptable error is when there is no merge base
    if (!error.includes('no merge base')) {
      throw new Error('Unexpected failure of `git diff` command')
    }

    // Try to fetch more commits
    // If there are none, it means there is no common history between base and HEAD
    if (deepen > Number.MAX_SAFE_INTEGER || !tryDeepen(deepen)) {
      core.info('No merge base found - all files will be listed as added')
      return listAllFilesAsAdded()
    }

    deepen = deepen * 2
  }
}

export function parseGitDiffOutput(output: string): File[] {
  const tokens = output.split('\u0000').filter(s => s.length > 0)
  const files: File[] = []
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    files.push({
      status: statusMap[tokens[i]],
      filename: tokens[i + 1]
    })
  }
  return files
}

export async function listAllFilesAsAdded(): Promise<File[]> {
  let output = ''
  try {
    await exec('git', ['ls-files', '-z'], {
      listeners: {
        stdout: (data: Buffer) => (output += data.toString())
      }
    })
  } finally {
    fixStdOutNullTermination()
  }

  return output
    .split('\u0000')
    .filter(s => s.length > 0)
    .map(path => ({
      status: ChangeStatus.Added,
      filename: path
    }))
}

export function isTagRef(ref: string): boolean {
  return ref.startsWith('refs/tags/')
}

export function trimRefs(ref: string): string {
  return trimStart(ref, 'refs/')
}

export function trimRefsHeads(ref: string): string {
  const trimRef = trimStart(ref, 'refs/')
  return trimStart(trimRef, 'heads/')
}

async function tryDeepen(deepen: number): Promise<boolean> {
  // The only indicator there is no more history I've found.
  // It forces the progress indicator and checks for 0 items from remote.
  // If you know something better please open PR with fix.
  let error = ''
  await exec('git', ['fetch', `--deepen=${deepen}`, '--no-tags', '--progress'], {
    listeners: {
      stderr: (data: Buffer) => (error += data.toString())
    }
  })
  return !error.includes('remote: Total 0 ')
}

function trimStart(ref: string, start: string): string {
  return ref.startsWith(start) ? ref.substr(start.length) : ref
}

function fixStdOutNullTermination(): void {
  // Previous command uses NULL as delimiters and output is printed to stdout.
  // We have to make sure next thing written to stdout will start on new line.
  // Otherwise things like ::set-output wouldn't work.
  core.info('')
}

const statusMap: {[char: string]: ChangeStatus} = {
  A: ChangeStatus.Added,
  C: ChangeStatus.Copied,
  D: ChangeStatus.Deleted,
  M: ChangeStatus.Modified,
  R: ChangeStatus.Renamed,
  U: ChangeStatus.Unmerged
}
