import exec from './exec'
import * as core from '@actions/core'
import {File, ChangeStatus} from './file'

export const NULL_SHA = '0000000000000000000000000000000000000000'

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
  if (!(await hasBranch(ref))) {
    // Fetch and add base branch
    core.startGroup(`Fetching ${ref} from origin until merge-base is found`)
    await exec('git', ['fetch', `--depth=${initialFetchDepth}`, '--no-tags', 'origin', `${ref}:${ref}`])
  }

  async function hasMergeBase(): Promise<boolean> {
    return (await exec('git', ['merge-base', ref, 'HEAD'], {ignoreReturnCode: true})).code === 0
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
  const branch = (await exec('git', ['branch', '--show-current'])).stdout.trim()
  if (branch) {
    return branch
  }

  const describe = await exec('git', ['describe', '--all', '--exact-match'], {ignoreReturnCode: true})
  if (describe.code === 0) {
    return describe.stdout.trim()
  }

  return (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim()
}

export async function getParentSha(ref: string): Promise<string> {
  const revParse = await exec('git', ['rev-parse', `${ref}~`], {ignoreReturnCode: true})
  if (revParse.code === 0) {
    return revParse.stdout.trim()
  }

  const parent = 'parent '
  const catFile = await exec('git', ['cat-file', '-p', ref])
  const parents = catFile.stdout
    .split('\n')
    .filter(line => line.startsWith(parent))
    .map(line => line.slice(parent.length).trim())
  return parents[0]
}

export function getShortName(ref: string): string {
  const trimRef = trimStart(ref, 'refs/')
  return trimStart(trimRef, 'heads/')
}

async function hasCommit(ref: string): Promise<boolean> {
  return (await exec('git', ['cat-file', '-e', `${ref}^{commit}`], {ignoreReturnCode: true})).code === 0
}

async function hasBranch(branch: string): Promise<boolean> {
  const showRef = await exec('git', ['show-ref', '--verify', '-q', `refs/heads/${branch}`], {ignoreReturnCode: true})
  return showRef.code === 0
}

async function getNumberOfCommits(ref: string): Promise<number> {
  const output = (await exec('git', ['rev-list', `--count`, ref])).stdout
  const count = parseInt(output)
  return isNaN(count) ? 0 : count
}

function trimStart(ref: string, start: string): string {
  if (!ref) {
    return ''
  }
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
