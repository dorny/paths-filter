import {exec} from '@actions/exec'
import {File, ChangeStatus} from './file'

export const NULL_SHA = '0000000000000000000000000000000000000000'
export const FETCH_HEAD = 'FETCH_HEAD'

export async function fetchCommit(ref: string): Promise<void> {
  const exitCode = await exec('git', ['fetch', '--depth=1', '--no-tags', 'origin', ref])
  if (exitCode !== 0) {
    throw new Error(`Fetching ${ref} failed`)
  }
}

export async function getChangedFiles(ref: string, cmd = exec): Promise<File[]> {
  let output = ''
  const exitCode = await cmd('git', ['diff-index', '--name-status', ref], {
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
    .map(parseGitDiffLine)
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

function trimStart(ref: string, start: string): string {
  return ref.startsWith(start) ? ref.substr(start.length) : ref
}

const statusMap: {[char: string]: ChangeStatus} = {
  A: ChangeStatus.Added,
  C: ChangeStatus.Copied,
  D: ChangeStatus.Deleted,
  M: ChangeStatus.Modified,
  R: ChangeStatus.Renamed,
  U: ChangeStatus.Unmerged
}

function parseGitDiffLine(line: string): File {
  const status = statusMap[line[0]]
  const filename = line.substr(8)
  return {filename, status}
}
