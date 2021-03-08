import exec from './exec'
import * as core from '@actions/core'
import {File, ChangeStatus} from './file'

export const NULL_SHA = '0000000000000000000000000000000000000000'
export const HEAD = 'HEAD'

export async function getChangesInLastCommit(): Promise<File[]> {
  core.startGroup(`Change detection in last commit`)
  let output = ''
  try {
    output = (await exec('git', ['log', '--format=', '--no-renames', '--name-status', '-z', '-n', '1'])).stdout
  } finally {
    fixStdOutNullTermination()
    core.endGroup()
  }

  return parseGitDiffOutput(output)
}

export async function getChanges(baseRef: string): Promise<File[]> {
  if (!(await hasCommit(baseRef))) {
    // Fetch single commit
    core.startGroup(`Fetching ${baseRef} from origin`)
    await exec('git', ['fetch', '--depth=1', '--no-tags', 'origin', baseRef])
    core.endGroup()
  }

  // Get differences between ref and HEAD
  core.startGroup(`Change detection ${baseRef}..HEAD`)
  let output = ''
  try {
    // Two dots '..' change detection - directly compares two versions
    output = (await exec('git', ['diff', '--no-renames', '--name-status', '-z', `${baseRef}..HEAD`])).stdout
  } finally {
    fixStdOutNullTermination()
    core.endGroup()
  }

  return parseGitDiffOutput(output)
}

export async function getChangesOnHead(): Promise<File[]> {
  // Get current changes - both staged and unstaged
  core.startGroup(`Change detection on HEAD`)
  let output = ''
  try {
    output = (await exec('git', ['diff', '--no-renames', '--name-status', '-z', 'HEAD'])).stdout
  } finally {
    fixStdOutNullTermination()
    core.endGroup()
  }

  return parseGitDiffOutput(output)
}

export async function getChangesSinceMergeBase(
  baseRef: string,
  ref: string,
  initialFetchDepth: number
): Promise<File[]> {
  async function hasMergeBase(): Promise<boolean> {
    return (await exec('git', ['merge-base', baseRef, ref], {ignoreReturnCode: true})).code === 0
  }

  let noMergeBase = false
  core.startGroup(`Searching for merge-base ${baseRef}...${ref}`)
  try {
    let lastCommitCount = await getCommitCount()
    let depth = Math.max(lastCommitCount * 2, initialFetchDepth)
    while (!(await hasMergeBase())) {
      await exec('git', ['fetch', `--depth=${depth}`, 'origin', `${baseRef}:${baseRef}`, `${ref}:${ref}`])
      const commitCount = await getCommitCount()
      if (commitCount === lastCommitCount) {
        core.info('No more commits were fetched')
        core.info('Last attempt will be to fetch full history')
        await exec('git', ['fetch', '--unshallow'])
        if (!(await hasMergeBase())) {
          noMergeBase = true
        }
        break
      }
      depth = Math.min(depth * 2, Number.MAX_SAFE_INTEGER)
      lastCommitCount = commitCount
    }
  } finally {
    core.endGroup()
  }

  if (noMergeBase) {
    core.warning('No merge base found - all files will be listed as added')
    return await listAllFilesAsAdded()
  }

  // Get changes introduced on HEAD compared to ref
  core.startGroup(`Change detection ${baseRef}...${ref}`)
  let output = ''
  try {
    // Three dots '...' change detection - finds merge-base and compares against it
    output = (await exec('git', ['diff', '--no-renames', '--name-status', '-z', `${baseRef}...${ref}`])).stdout
  } finally {
    fixStdOutNullTermination()
    core.endGroup()
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
  core.startGroup('Listing all files tracked by git')
  let output = ''
  try {
    output = (await exec('git', ['ls-files', '-z'])).stdout
  } finally {
    fixStdOutNullTermination()
    core.endGroup()
  }

  return output
    .split('\u0000')
    .filter(s => s.length > 0)
    .map(path => ({
      status: ChangeStatus.Added,
      filename: path
    }))
}

export async function getCurrentRef(): Promise<string> {
  core.startGroup(`Determining current ref`)
  try {
    const branch = (await exec('git', ['branch', '--show-current'])).stdout.trim()
    if (branch) {
      return branch
    }

    const describe = await exec('git', ['describe', '--tags', '--exact-match'], {ignoreReturnCode: true})
    if (describe.code === 0) {
      return describe.stdout.trim()
    }

    return (await exec('git', ['rev-parse', HEAD])).stdout.trim()
  } finally {
    core.endGroup()
  }
}

export function getShortName(ref: string): string {
  if (!ref) return ''

  const heads = 'refs/heads/'
  const tags = 'refs/tags/'

  if (ref.startsWith(heads)) return ref.slice(heads.length)
  if (ref.startsWith(tags)) return ref.slice(tags.length)

  return ref
}

export function isGitSha(ref: string): boolean {
  return /^[a-z0-9]{40}$/.test(ref)
}

async function hasCommit(ref: string): Promise<boolean> {
  core.startGroup(`Checking if commit for ${ref} is locally available`)
  try {
    return (await exec('git', ['cat-file', '-e', `${ref}^{commit}`], {ignoreReturnCode: true})).code === 0
  } finally {
    core.endGroup()
  }
}

async function getCommitCount(): Promise<number> {
  const output = (await exec('git', ['rev-list', '--count', '--all'])).stdout
  const count = parseInt(output)
  return isNaN(count) ? 0 : count
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
