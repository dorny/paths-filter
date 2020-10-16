import exec from './exec'
import * as core from '@actions/core'
import {File, ChangeStatus} from './file'

export const NULL_SHA = '0000000000000000000000000000000000000000'

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

export async function getChanges(ref: string): Promise<File[]> {
  if (!(await hasCommit(ref))) {
    // Fetch single commit
    core.startGroup(`Fetching ${ref} from origin`)
    await exec('git', ['fetch', '--depth=1', '--no-tags', 'origin', ref])
    core.endGroup()
  }

  // Get differences between ref and HEAD
  core.startGroup(`Change detection ${ref}..HEAD`)
  let output = ''
  try {
    // Two dots '..' change detection - directly compares two versions
    output = (await exec('git', ['diff', '--no-renames', '--name-status', '-z', `${ref}..HEAD`])).stdout
  } finally {
    fixStdOutNullTermination()
    core.endGroup()
  }

  return parseGitDiffOutput(output)
}

export async function getChangesSinceMergeBase(ref: string, initialFetchDepth: number): Promise<File[]> {
  if (!(await hasCommit(ref))) {
    // Fetch and add base branch
    core.startGroup(`Fetching ${ref}`)
    try {
      await exec('git', ['fetch', `--depth=${initialFetchDepth}`, '--no-tags', 'origin', `${ref}:${ref}`])
    } finally {
      core.endGroup()
    }
  }

  async function hasMergeBase(): Promise<boolean> {
    return (await exec('git', ['merge-base', ref, 'HEAD'], {ignoreReturnCode: true})).code === 0
  }

  async function countCommits(): Promise<number> {
    return (await getNumberOfCommits('HEAD')) + (await getNumberOfCommits(ref))
  }

  core.startGroup(`Searching for merge-base with ${ref}`)
  // Fetch more commits until merge-base is found
  if (!(await hasMergeBase())) {
    let deepen = initialFetchDepth
    let lastCommitsCount = await countCommits()
    do {
      await exec('git', ['fetch', `--deepen=${deepen}`, '--no-tags'])
      const count = await countCommits()
      if (count <= lastCommitsCount) {
        core.info('No merge base found - all files will be listed as added')
        core.endGroup()
        return await listAllFilesAsAdded()
      }
      lastCommitsCount = count
      deepen = Math.min(deepen * 2, Number.MAX_SAFE_INTEGER)
    } while (!(await hasMergeBase()))
  }
  core.endGroup()

  // Get changes introduced on HEAD compared to ref
  core.startGroup(`Change detection ${ref}...HEAD`)
  let output = ''
  try {
    // Three dots '...' change detection - finds merge-base and compares against it
    output = (await exec('git', ['diff', '--no-renames', '--name-status', '-z', `${ref}...HEAD`])).stdout
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

    return (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim()
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

async function getNumberOfCommits(ref: string): Promise<number> {
  const output = (await exec('git', ['rev-list', `--count`, ref])).stdout
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
