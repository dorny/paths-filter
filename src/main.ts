import * as fs from 'fs'
import * as core from '@actions/core'
import * as github from '@actions/github'
import {Webhooks} from '@octokit/webhooks'

import {Filter, FilterResults} from './filter'
import {File, ChangeStatus} from './file'
import * as git from './git'
import {backslashEscape, shellEscape} from './list-format/shell-escape'
import {csvEscape} from './list-format/csv-escape'

type FilesExportFormat = 'none' | 'csv' | 'json' | 'shell' | 'escape'
type StatExportFormat = 'none' | 'csv' | 'json'

async function run(): Promise<void> {
  try {
    const workingDirectory = core.getInput('working-directory', {required: false})
    if (workingDirectory) {
      process.chdir(workingDirectory)
    }

    const token = core.getInput('token', {required: false})
    const ref = core.getInput('ref', {required: false})
    const base = core.getInput('base', {required: false})
    const filtersInput = core.getInput('filters', {required: true})
    const filtersYaml = isPathInput(filtersInput) ? getConfigFileContent(filtersInput) : filtersInput
    const listFilesFormat = core.getInput('list-files', {required: false}).toLowerCase() || 'none'
    const statFormat = core.getInput('stat', {required: false}).toLowerCase() || 'none'
    const initialFetchDepth = parseInt(core.getInput('initial-fetch-depth', {required: false})) || 10

    if (!isFilesExportFormat(listFilesFormat)) {
      core.setFailed(`Input parameter 'list-files' is set to invalid value '${listFilesFormat}'`)
      return
    }

    if (!isStatExportFormat(statFormat)) {
      core.setFailed(`Input parameter 'stat' is set to invalid value '${statFormat}'`)
      return
    }

    const filter = new Filter(filtersYaml)
    const files = await getChangedFiles(token, base, ref, initialFetchDepth)
    core.info(`Detected ${files.length} changed files`)
    const results = filter.match(files)
    exportResults(results, listFilesFormat, statFormat)
  } catch (error) {
    core.setFailed(error.message)
  }
}

function isPathInput(text: string): boolean {
  return !(text.includes('\n') || text.includes(':'))
}

function getConfigFileContent(configPath: string): string {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file '${configPath}' not found`)
  }

  if (!fs.lstatSync(configPath).isFile()) {
    throw new Error(`'${configPath}' is not a file.`)
  }

  return fs.readFileSync(configPath, {encoding: 'utf8'})
}

async function getChangedFiles(token: string, base: string, ref: string, initialFetchDepth: number): Promise<File[]> {
  // if base is 'HEAD' only local uncommitted changes will be detected
  // This is the simplest case as we don't need to fetch more commits or evaluate current/before refs
  if (base === git.HEAD) {
    if (ref) {
      core.warning(`'ref' input parameter is ignored when 'base' is set to HEAD`)
    }
    return await git.getChangesOnHead()
  }

  const prEvents = ['pull_request', 'pull_request_review', 'pull_request_review_comment', 'pull_request_target']
  if (prEvents.includes(github.context.eventName)) {
    if (ref) {
      core.warning(`'ref' input parameter is ignored when 'base' is set to HEAD`)
    }
    if (base) {
      core.warning(`'base' input parameter is ignored when action is triggered by pull request event`)
    }
    const pr = github.context.payload.pull_request as Webhooks.WebhookPayloadPullRequestPullRequest
    if (token) {
      return await getChangedFilesFromApi(token, pr)
    }
    if (github.context.eventName === 'pull_request_target') {
      // pull_request_target is executed in context of base branch and GITHUB_SHA points to last commit in base branch
      // Therefor it's not possible to look at changes in last commit
      // At the same time we don't want to fetch any code from forked repository
      throw new Error(`'token' input parameter is required if action is triggered by 'pull_request_target' event`)
    }
    core.info('Github token is not available - changes will be detected from PRs merge commit')
    return await git.getChangesInLastCommit()
  } else {
    return getChangedFilesFromGit(base, ref, initialFetchDepth)
  }
}

async function getChangedFilesFromGit(base: string, head: string, initialFetchDepth: number): Promise<File[]> {
  const defaultBranch = github.context.payload.repository?.default_branch

  const beforeSha =
    github.context.eventName === 'push' ? (github.context.payload as Webhooks.WebhookPayloadPush).before : null

  const currentRef = await git.getCurrentRef()

  head = git.getShortName(head || github.context.ref || currentRef)
  base = git.getShortName(base || defaultBranch)

  if (!head) {
    throw new Error(
      "This action requires 'head' input to be configured, 'ref' to be set in the event payload or branch/tag checked out in current git repository"
    )
  }

  if (!base) {
    throw new Error(
      "This action requires 'base' input to be configured or 'repository.default_branch' to be set in the event payload"
    )
  }

  const isBaseSha = git.isGitSha(base)
  const isBaseSameAsHead = base === head

  // If base is commit SHA we will do comparison against the referenced commit
  // Or if base references same branch it was pushed to, we will do comparison against the previously pushed commit
  if (isBaseSha || isBaseSameAsHead) {
    const baseSha = isBaseSha ? base : beforeSha
    if (!baseSha) {
      core.warning(`'before' field is missing in event payload - changes will be detected from last commit`)
      if (head !== currentRef) {
        core.warning(`Ref ${head} is not checked out - results might be incorrect!`)
      }
      return await git.getChangesInLastCommit()
    }

    // If there is no previously pushed commit,
    // we will do comparison against the default branch or return all as added
    if (baseSha === git.NULL_SHA) {
      if (defaultBranch && base !== defaultBranch) {
        core.info(
          `First push of a branch detected - changes will be detected against the default branch ${defaultBranch}`
        )
        return await git.getChangesSinceMergeBase(defaultBranch, head, initialFetchDepth)
      } else {
        core.info('Initial push detected - all files will be listed as added')
        if (head !== currentRef) {
          core.warning(`Ref ${head} is not checked out - results might be incorrect!`)
        }
        return await git.listAllFilesAsAdded()
      }
    }

    core.info(`Changes will be detected between ${baseSha} and ${head}`)
    return await git.getChanges(baseSha, head)
  }

  core.info(`Changes will be detected between ${base} and ${head}`)
  return await git.getChangesSinceMergeBase(base, head, initialFetchDepth)
}

// Uses github REST api to get list of files changed in PR
async function getChangedFilesFromApi(
  token: string,
  prNumber: Webhooks.WebhookPayloadPullRequestPullRequest
): Promise<File[]> {
  core.startGroup(`Fetching list of changed files for PR#${prNumber.number} from Github API`)
  try {
    const client = new github.GitHub(token)
    const per_page = 100
    const files: File[] = []

    for (let page = 1; ; page++) {
      core.info(`Invoking listFiles(pull_number: ${prNumber.number}, page: ${page}, per_page: ${per_page})`)
      const response = await client.pulls.listFiles({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        pull_number: prNumber.number,
        per_page,
        page
      })

      if (response.status !== 200) {
        throw new Error(`Fetching list of changed files from GitHub API failed with error code ${response.status}`)
      }

      core.info(`Received ${response.data.length} items`)
      if (response.data.length === 0) {
        core.info('All changed files has been fetched from GitHub API')
        break
      }

      for (const row of response.data) {
        core.info(`[${row.status}] ${row.filename}`)
        // There's no obvious use-case for detection of renames
        // Therefore we treat it as if rename detection in git diff was turned off.
        // Rename is replaced by delete of original filename and add of new filename
        if (row.status === ChangeStatus.Renamed) {
          files.push({
            filename: row.filename,
            status: ChangeStatus.Added,
            additions: row.additions,
            deletions: row.deletions,
          })
          files.push({
            // 'previous_filename' for some unknown reason isn't in the type definition or documentation
            filename: (<any>row).previous_filename as string,
            status: ChangeStatus.Deleted,
            additions: row.additions,
            deletions: row.deletions,
          })
        } else {
          // Github status and git status variants are same except for deleted files
          const status = row.status === 'removed' ? ChangeStatus.Deleted : (row.status as ChangeStatus)
          files.push({
            filename: row.filename,
            status,
            additions: row.additions,
            deletions: row.deletions,
          })
        }
      }
    }

    return files
  } finally {
    core.endGroup()
  }
}

interface Stat {
  additionCount: number,
  deletionCount: number,
  fileCount: number
}

function exportResults(results: FilterResults, filesFormat: FilesExportFormat, statFormat: StatExportFormat): void {
  core.info('Results:')
  const changes: string[] = []
  const changeStats: {[key: string]: Stat} = {}

  for (const [key, files] of Object.entries(results)) {
    const hasMatchingFiles = files.length > 0
    core.startGroup(`Filter ${key} = ${hasMatchingFiles}`)
    if (files.length > 0) {
      changes.push(key)
      core.info('Matching files:')
      for (const file of files) {
        core.info(`${file.filename} [${file.status}]`)
      }
    } else {
      core.info('Matching files: none')
    }

    core.setOutput(key, hasMatchingFiles)
    core.setOutput(`${key}_count`, files.length)
    if (filesFormat !== 'none') {
      const filesValue = serializeExportChangedFiles(files, filesFormat)
      core.setOutput(`${key}_files`, filesValue)
    }

    const additionCount: number = files.reduce((sum, f) => sum + f.additions, 0)
    const deletionCount: number = files.reduce((sum, f) => sum + f.deletions, 0)
    core.setOutput(`${key}_addition_count`, additionCount)
    core.setOutput(`${key}_deletion_count`, deletionCount)
    core.setOutput(`${key}_change_count`, additionCount + deletionCount)
    changeStats[key] = {
      additionCount, deletionCount, fileCount: files.length
    }

    core.endGroup()
  }

  if (results['changes'] === undefined) {
    const changesJson = JSON.stringify(changes)
    core.info(`Changes output set to ${changesJson}`)
    core.setOutput('changes', changesJson)
  } else {
    core.info('Cannot set changes output variable - name already used by filter output')
  }

  if (statFormat !== 'none') {
    const statValue = serializeExportStat(changeStats, statFormat)
    core.setOutput(`stat`, statValue)
  }
}

function serializeExportChangedFiles(files: File[], format: FilesExportFormat): string {
  const fileNames = files.map(file => file.filename)
  switch (format) {
    case 'csv':
      return fileNames.map(csvEscape).join(',')
    case 'json':
      return JSON.stringify(fileNames)
    case 'escape':
      return fileNames.map(backslashEscape).join(' ')
    case 'shell':
      return fileNames.map(shellEscape).join(' ')
    default:
      return ''
  }
}

function serializeExportStat(stat: {[key: string]: Stat}, format: StatExportFormat): string {
  switch (format) {
    case 'csv':
      return Object.keys(stat).sort().map(k =>
        [csvEscape(k), stat[k].additionCount, stat[k].deletionCount, stat[k].fileCount]
          .join(',')
      ).join('\n')
    case 'json':
      return JSON.stringify(stat)
    default:
      return ''
  }
}

function isFilesExportFormat(value: string): value is FilesExportFormat {
  return ['none', 'csv', 'shell', 'json', 'escape'].includes(value)
}

function isStatExportFormat(value: string): value is StatExportFormat {
  return ['none', 'csv', 'json'].includes(value)
}

run()
