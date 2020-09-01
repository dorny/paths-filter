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
    // Two dots '..' change detection - directly compares two versions
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

export async function getChangesSinceRef(ref: string, initialFetchDepth: number): Promise<File[]> {
  // Fetch and add base branch
  await exec('git', ['fetch', `--depth=${initialFetchDepth}`, '--no-tags', 'origin', `${ref}:${ref}`])

  async function hasMergeBase(): Promise<boolean> {
    return (await exec('git', ['merge-base', ref, 'HEAD'], {ignoreReturnCode: true})) === 0
  }

  async function countCommits(): Promise<number> {
    return (await getNumberOfCommits('HEAD')) + (await getNumberOfCommits(ref))
  }

  // Fetch more commits until merge-base is found
  if (!(await hasMergeBase())) {
    let deepen = initialFetchDepth
    let lastCommitsCount = await countCommits()
    do {
      await exec('git', ['fetch', `--deepen=${deepen}`, '--no-tags', '--no-auto-gc', '-q'])
      const count = await countCommits()
      if (count <= lastCommitsCount) {
        core.info('No merge base found - all files will be listed as added')
        return await listAllFilesAsAdded()
      }
      lastCommitsCount = count
      deepen = Math.min(deepen * 2, Number.MAX_SAFE_INTEGER)
    } while (!(await hasMergeBase()))
  }

  // Get changes introduced on HEAD compared to ref
  let output = ''
  try {
    // Three dots '...' change detection - finds merge-base and compares against it
    await exec('git', ['diff', '--no-renames', '--name-status', '-z', `${ref}...HEAD`], {
      listeners: {
        stdout: (data: Buffer) => (output += data.toString())
      }
    })
  } finally {
    fixStdOutNullTermination()
  }

  return parseGitDiffOutput(output)
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

async function getNumberOfCommits(ref: string): Promise<number> {
  let output = ''
  await exec('git', ['rev-list', `--count`, ref], {
    listeners: {
      stdout: (data: Buffer) => (output += data.toString())
    }
  })
  const count = parseInt(output)
  return isNaN(count) ? 0 : count
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
