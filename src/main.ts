import * as fs from 'fs'
import * as core from '@actions/core'
import * as github from '@actions/github'
import {Webhooks} from '@octokit/webhooks'

import {Filter, FilterResults} from './filter'
import {File, ChangeStatus} from './file'
import * as git from './git'
import {backslashEscape, shellEscape} from './list-format/shell-escape'
import {csvEscape} from './list-format/csv-escape'

type ExportFormat = 'none' | 'csv' | 'json' | 'shell' | 'escape'

async function run(): Promise<void> {
  try {
    const workingDirectory = core.getInput('working-directory', {required: false})
    if (workingDirectory) {
      process.chdir(workingDirectory)
    }

    const token = core.getInput('token', {required: false})
    const base = core.getInput('base', {required: false})
    const filtersInput = core.getInput('filters', {required: true})
    const filtersYaml = isPathInput(filtersInput) ? getConfigFileContent(filtersInput) : filtersInput
    const listFiles = core.getInput('list-files', {required: false}).toLowerCase() || 'none'
    const initialFetchDepth = parseInt(core.getInput('initial-fetch-depth', {required: false})) || 10

    if (!isExportFormat(listFiles)) {
      core.setFailed(`Input parameter 'list-files' is set to invalid value '${listFiles}'`)
      return
    }

    const filter = new Filter(filtersYaml)
    const files = await getChangedFiles(token, base, initialFetchDepth)
    const results = filter.match(files)
    exportResults(results, listFiles)
  } catch (error) {
    core.setFailed(error.message)
  }
}

function isPathInput(text: string): boolean {
  return !text.includes('\n')
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

async function getChangedFiles(token: string, base: string, initialFetchDepth: number): Promise<File[]> {
  // if base is 'HEAD' only local uncommitted changes will be detected
  // This is the simplest case as we don't need to fetch more commits or evaluate current/before refs
  if (base === git.HEAD) {
    return await git.getChangesOnHead()
  }

  if (github.context.eventName === 'pull_request' || github.context.eventName === 'pull_request_target') {
    const pr = github.context.payload.pull_request as Webhooks.WebhookPayloadPullRequestPullRequest
    if (token) {
      return await getChangedFilesFromApi(token, pr)
    }
    core.info('Github token is not available - changes will be detected from PRs merge commit')
    return await git.getChangesInLastCommit()
  } else {
    return getChangedFilesFromGit(base, initialFetchDepth)
  }
}

async function getChangedFilesFromGit(base: string, initialFetchDepth: number): Promise<File[]> {
  const defaultRef = github.context.payload.repository?.default_branch

  const beforeSha =
    github.context.eventName === 'push' ? (github.context.payload as Webhooks.WebhookPayloadPush).before : null

  const pushRef =
    git.getShortName(github.context.ref) ||
    (core.warning(`'ref' field is missing in event payload - using current branch, tag or commit SHA`),
    await git.getCurrentRef())

  const baseRef = git.getShortName(base) || defaultRef
  if (!baseRef) {
    throw new Error(
      "This action requires 'base' input to be configured or 'repository.default_branch' to be set in the event payload"
    )
  }

  const isBaseRefSha = git.isGitSha(baseRef)
  const isBaseSameAsPush = baseRef === pushRef

  // If base is commit SHA we will do comparison against the referenced commit
  // Or if base references same branch it was pushed to, we will do comparison against the previously pushed commit
  if (isBaseRefSha || isBaseSameAsPush) {
    if (!isBaseRefSha && !beforeSha) {
      core.warning(`'before' field is missing in event payload - changes will be detected from last commit`)
      return await git.getChangesInLastCommit()
    }

    const baseSha = isBaseRefSha ? baseRef : beforeSha
    // If there is no previously pushed commit,
    // we will do comparison against the default branch or return all as added
    if (baseSha === git.NULL_SHA) {
      if (defaultRef && baseRef !== defaultRef) {
        core.info(`First push of a branch detected - changes will be detected against the default branch ${defaultRef}`)
        return await git.getChangesSinceMergeBase(defaultRef, initialFetchDepth)
      } else {
        core.info('Initial push detected - all files will be listed as added')
        return await git.listAllFilesAsAdded()
      }
    }

    core.info(`Changes will be detected against commit (${baseSha})`)
    return await git.getChanges(baseSha)
  }

  // Changes introduced by current branch against the base branch
  core.info(`Changes will be detected against the branch ${baseRef}`)
  return await git.getChangesSinceMergeBase(baseRef, initialFetchDepth)
}

// Uses github REST api to get list of files changed in PR
async function getChangedFilesFromApi(
  token: string,
  pullRequest: Webhooks.WebhookPayloadPullRequestPullRequest
): Promise<File[]> {
  core.startGroup(`Fetching list of changed files for PR#${pullRequest.number} from Github API`)
  core.info(`Number of changed_files is ${pullRequest.changed_files}`)
  const client = new github.GitHub(token)
  const pageSize = 100
  const files: File[] = []
  for (let page = 1; (page - 1) * pageSize < pullRequest.changed_files; page++) {
    core.info(`Invoking listFiles(pull_number: ${pullRequest.number}, page: ${page}, per_page: ${pageSize})`)
    const response = await client.pulls.listFiles({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      pull_number: pullRequest.number,
      page,
      per_page: pageSize
    })
    for (const row of response.data) {
      core.info(`[${row.status}] ${row.filename}`)
      // There's no obvious use-case for detection of renames
      // Therefore we treat it as if rename detection in git diff was turned off.
      // Rename is replaced by delete of original filename and add of new filename
      if (row.status === ChangeStatus.Renamed) {
        files.push({
          filename: row.filename,
          status: ChangeStatus.Added
        })
        files.push({
          // 'previous_filename' for some unknown reason isn't in the type definition or documentation
          filename: (<any>row).previous_filename as string,
          status: ChangeStatus.Deleted
        })
      } else {
        // Github status and git status variants are same except for deleted files
        const status = row.status === 'removed' ? ChangeStatus.Deleted : (row.status as ChangeStatus)
        files.push({
          filename: row.filename,
          status
        })
      }
    }
  }

  core.endGroup()
  return files
}

function exportResults(results: FilterResults, format: ExportFormat): void {
  core.info('Results:')
  const changes = []
  for (const [key, files] of Object.entries(results)) {
    const value = files.length > 0
    core.startGroup(`Filter ${key} = ${value}`)
    if (files.length > 0) {
      changes.push(key)
      core.info('Matching files:')
      for (const file of files) {
        core.info(`${file.filename} [${file.status}]`)
      }
    } else {
      core.info('Matching files: none')
    }

    core.setOutput(key, value)
    core.setOutput(`${key}_count`, files.length)
    if (format !== 'none') {
      const filesValue = serializeExport(files, format)
      core.setOutput(`${key}_files`, filesValue)
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
}

function serializeExport(files: File[], format: ExportFormat): string {
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

function isExportFormat(value: string): value is ExportFormat {
  return ['none', 'csv', 'shell', 'json', 'escape'].includes(value)
}

run()
