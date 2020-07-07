import {exec} from '@actions/exec'
import * as core from '@actions/core'
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
  const exitCode = await cmd('git', ['diff-index', '--name-status', '-z', ref], {
    listeners: {
      stdout: (data: Buffer) => (output += data.toString())
    }
  })

  if (exitCode !== 0) {
    throw new Error(`Couldn't determine changed files`)
  }

  // Previous command uses NULL as delimiters and output is printed to stdout.
  // We have to make sure next thing written to stdout will start on new line.
  // Otherwise things like ::set-output wouldn't work.
  core.info('')

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
