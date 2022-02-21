import {getExecOutput} from '@actions/exec'
import * as core from '@actions/core'
import {File, ChangeStatus, FileNumstat, FileStatus} from './file'

export const NULL_SHA = '0000000000000000000000000000000000000000'
export const HEAD = 'HEAD'

export async function getChangesInLastCommit(): Promise<File[]> {
  return core.group(`Change detection in last commit`, async () => {
    try {
      // Calling git log on the last commit works when only the last commit may be checked out. Calling git diff HEAD^..HEAD needs two commits.
      const statusOutput = (
        await getExecOutput('git', ['log', '--format=', '--no-renames', '--name-status', '-z', '-n', '1'])
      ).stdout
      const numstatOutput = (
        await getExecOutput('git', ['log', '--format=', '--no-renames', '--numstat', '-z', '-n', '1'])
      ).stdout
      const statusFiles = parseGitDiffNameStatusOutput(statusOutput)
      const numstatFiles = parseGitDiffNumstatOutput(numstatOutput)
      return mergeStatusNumstat(statusFiles, numstatFiles)
    } finally {
      fixStdOutNullTermination()
    }
  })
}

export async function getChanges(base: string, head: string): Promise<File[]> {
  const baseRef = await ensureRefAvailable(base)
  const headRef = await ensureRefAvailable(head)

  // Get differences between ref and HEAD
  // Two dots '..' change detection - directly compares two versions
  return core.group(`Change detection ${base}..${head}`, () => getGitDiffStatusNumstat(`${baseRef}..${headRef}`))
}

export async function getChangesOnHead(): Promise<File[]> {
  // Get current changes - both staged and unstaged
  return core.group(`Change detection on HEAD`, () => getGitDiffStatusNumstat(`HEAD`))
}

export async function getChangesSinceMergeBase(base: string, head: string, initialFetchDepth: number): Promise<File[]> {
  let baseRef: string | undefined
  let headRef: string | undefined
  async function hasMergeBase(): Promise<boolean> {
    if (baseRef === undefined || headRef === undefined) {
      return false
    }
    return (await getExecOutput('git', ['merge-base', baseRef, headRef], {ignoreReturnCode: true})).exitCode === 0
  }

  let noMergeBase = false
  core.startGroup(`Searching for merge-base ${base}...${head}`)
  try {
    baseRef = await getLocalRef(base)
    headRef = await getLocalRef(head)
    if (!(await hasMergeBase())) {
      await getExecOutput('git', ['fetch', '--no-tags', `--depth=${initialFetchDepth}`, 'origin', base, head])
      if (baseRef === undefined || headRef === undefined) {
        baseRef = baseRef ?? (await getLocalRef(base))
        headRef = headRef ?? (await getLocalRef(head))
        if (baseRef === undefined || headRef === undefined) {
          await getExecOutput('git', ['fetch', '--tags', '--depth=1', 'origin', base, head], {
            ignoreReturnCode: true // returns exit code 1 if tags on remote were updated - we can safely ignore it
          })
          baseRef = baseRef ?? (await getLocalRef(base))
          headRef = headRef ?? (await getLocalRef(head))
          if (baseRef === undefined) {
            throw new Error(
              `Could not determine what is ${base} - fetch works but it's not a branch, tag or commit SHA`
            )
          }
          if (headRef === undefined) {
            throw new Error(
              `Could not determine what is ${head} - fetch works but it's not a branch, tag or commit SHA`
            )
          }
        }
      }

      let depth = initialFetchDepth
      let lastCommitCount = await getCommitCount()
      while (!(await hasMergeBase())) {
        depth = Math.min(depth * 2, Number.MAX_SAFE_INTEGER)
        await getExecOutput('git', ['fetch', `--deepen=${depth}`, 'origin', base, head])
        const commitCount = await getCommitCount()
        if (commitCount === lastCommitCount) {
          core.info('No more commits were fetched')
          core.info('Last attempt will be to fetch full history')
          await getExecOutput('git', ['fetch'])
          if (!(await hasMergeBase())) {
            noMergeBase = true
          }
          break
        }
        lastCommitCount = commitCount
      }
    }
  } finally {
    core.endGroup()
  }

  // Three dots '...' change detection - finds merge-base and compares against it
  let diffArg = `${baseRef}...${headRef}`
  if (noMergeBase) {
    core.warning('No merge base found - change detection will use direct <commit>..<commit> comparison')
    diffArg = `${baseRef}..${headRef}`
  }

  // Get changes introduced on ref compared to base
  return getGitDiffStatusNumstat(diffArg)
}

async function gitDiffNameStatus(diffArg: string): Promise<string> {
  let output = ''
  try {
    output = (await getExecOutput('git', ['diff', '--no-renames', '--name-status', '-z', diffArg])).stdout
  } finally {
    fixStdOutNullTermination()
  }
  return output
}

async function gitDiffNumstat(diffArg: string): Promise<string> {
  let output = ''
  try {
    output = (await getExecOutput('git', ['diff', '--no-renames', '--numstat', '-z', diffArg])).stdout
  } finally {
    fixStdOutNullTermination()
  }
  return output
}

export function parseGitDiffNameStatusOutput(output: string): FileStatus[] {
  const tokens = output.split('\u0000').filter(s => s.length > 0)
  const files: FileStatus[] = []
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    files.push({
      status: statusMap[tokens[i]],
      filename: tokens[i + 1]
    })
  }
  return files
}

function mergeStatusNumstat(statusEntries: FileStatus[], numstatEntries: FileNumstat[]): File[] {
  const statusMap: {[key: string]: FileStatus} = {}
  statusEntries.forEach(f => (statusMap[f.filename] = f))

  return numstatEntries.map(f => {
    const status = statusMap[f.filename]
    if (!status) {
      throw new Error(`Cannot find the status entry for file: ${f.filename}`)
    }
    return {...f, status: status.status}
  })
}

export async function getGitDiffStatusNumstat(diffArg: string) {
  const statusFiles = await gitDiffNameStatus(diffArg).then(parseGitDiffNameStatusOutput)
  const numstatFiles = await gitDiffNumstat(diffArg).then(parseGitDiffNumstatOutput)
  return mergeStatusNumstat(statusFiles, numstatFiles)
}

export function parseGitDiffNumstatOutput(output: string): FileNumstat[] {
  const rows = output.split('\u0000').filter(s => s.length > 0)
  return rows.map(row => {
    const tokens = row.split('\t')
    // For the binary files set the numbers to zero. This matches the response of Github API.
    const additions = tokens[0] == '-' ? 0 : Number.parseInt(tokens[0])
    const deletions = tokens[1] == '-' ? 0 : Number.parseInt(tokens[1])
    return {
      filename: tokens[2],
      additions,
      deletions
    }
  })
}

export async function listAllFilesAsAdded(): Promise<File[]> {
  return core.group(`Listing all files tracked by git`, async () => {
    const emptyTreeHash = (await getExecOutput('git', ['hash-object', '-t', 'tree', '/dev/null'])).stdout
    return getGitDiffStatusNumstat(emptyTreeHash)
  })
}

export async function getCurrentRef(): Promise<string> {
  core.startGroup(`Get current git ref`)
  try {
    const branch = (await getExecOutput('git', ['branch', '--show-current'])).stdout.trim()
    if (branch) {
      return branch
    }

    const describe = await getExecOutput('git', ['describe', '--tags', '--exact-match'], {ignoreReturnCode: true})
    if (describe.exitCode === 0) {
      return describe.stdout.trim()
    }

    return (await getExecOutput('git', ['rev-parse', HEAD])).stdout.trim()
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
  return (await getExecOutput('git', ['cat-file', '-e', `${ref}^{commit}`], {ignoreReturnCode: true})).exitCode === 0
}

async function getCommitCount(): Promise<number> {
  const output = (await getExecOutput('git', ['rev-list', '--count', '--all'])).stdout
  const count = parseInt(output)
  return isNaN(count) ? 0 : count
}

async function getLocalRef(shortName: string): Promise<string | undefined> {
  if (isGitSha(shortName)) {
    return (await hasCommit(shortName)) ? shortName : undefined
  }

  const output = (await getExecOutput('git', ['show-ref', shortName], {ignoreReturnCode: true})).stdout
  const refs = output
    .split(/\r?\n/g)
    .map(l => l.match(/refs\/(?:(?:heads)|(?:tags)|(?:remotes\/origin))\/(.*)$/))
    .filter(match => match !== null && match[1] === shortName)
    .map(match => match?.[0] ?? '') // match can't be null here but compiler doesn't understand that

  if (refs.length === 0) {
    return undefined
  }

  const remoteRef = refs.find(ref => ref.startsWith('refs/remotes/origin/'))
  if (remoteRef) {
    return remoteRef
  }

  return refs[0]
}

async function ensureRefAvailable(name: string): Promise<string> {
  core.startGroup(`Ensuring ${name} is fetched from origin`)
  try {
    let ref = await getLocalRef(name)
    if (ref === undefined) {
      await getExecOutput('git', ['fetch', '--depth=1', '--no-tags', 'origin', name])
      ref = await getLocalRef(name)
      if (ref === undefined) {
        await getExecOutput('git', ['fetch', '--depth=1', '--tags', 'origin', name])
        ref = await getLocalRef(name)
        if (ref === undefined) {
          throw new Error(`Could not determine what is ${name} - fetch works but it's not a branch, tag or commit SHA`)
        }
      }
    }

    return ref
  } finally {
    core.endGroup()
  }
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
