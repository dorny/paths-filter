import * as fs from 'fs'
import * as core from '@actions/core'
import * as github from '@actions/github'
import {Webhooks} from '@octokit/webhooks'

import {Filter, FilterResults} from './filter'
import {File, ChangeStatus} from './file'
import * as git from './git'
import shellEscape from './shell-escape'

type ExportFormat = 'none' | 'json' | 'shell'

async function run(): Promise<void> {
  try {
    const workingDirectory = core.getInput('working-directory', {required: false})
    if (workingDirectory) {
      process.chdir(workingDirectory)
    }

    const token = core.getInput('token', {required: false})
    const filtersInput = core.getInput('filters', {required: true})
    const filtersYaml = isPathInput(filtersInput) ? getConfigFileContent(filtersInput) : filtersInput
    const listFiles = core.getInput('list-files', {required: false}).toLowerCase() || 'none'

    if (!isExportFormat(listFiles)) {
      core.setFailed(`Input parameter 'list-files' is set to invalid value '${listFiles}'`)
      return
    }

    const filter = new Filter(filtersYaml)
    const files = await getChangedFiles(token)
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

async function getChangedFiles(token: string): Promise<File[]> {
  if (github.context.eventName === 'pull_request' || github.context.eventName === 'pull_request_target') {
    const pr = github.context.payload.pull_request as Webhooks.WebhookPayloadPullRequestPullRequest
    return token ? await getChangedFilesFromApi(token, pr) : await git.getChangesSinceRef(pr.base.ref)
  } else if (github.context.eventName === 'push') {
    return getChangedFilesFromPush()
  } else {
    throw new Error('This action can be triggered only by pull_request, pull_request_target or push event')
  }
}

async function getChangedFilesFromPush(): Promise<File[]> {
  const push = github.context.payload as Webhooks.WebhookPayloadPush

  // No change detection for pushed tags
  if (git.isTagRef(push.ref)) {
    core.info('Workflow is triggered by pushing of tag - all files will be listed as added')
    return await git.listAllFilesAsAdded()
  }

  const baseRef = git.trimRefsHeads(core.getInput('base', {required: false}) || push.repository.default_branch)
  const pushRef = git.trimRefsHeads(push.ref)

  // If base references same branch it was pushed to, we will do comparison against the previously pushed commit.
  if (baseRef === pushRef) {
    if (push.before === git.NULL_SHA) {
      core.info('First push of a branch detected - all files will be listed as added')
      return await git.listAllFilesAsAdded()
    }

    core.info(`Changes will be detected against the last previously pushed commit on same branch (${pushRef})`)
    return await git.getChangesAgainstSha(push.before)
  }

  // Changes introduced by current branch against the base branch
  core.info(`Changes will be detected against the branch ${baseRef}`)
  return await git.getChangesSinceRef(baseRef)
}

// Uses github REST api to get list of files changed in PR
async function getChangedFilesFromApi(
  token: string,
  pullRequest: Webhooks.WebhookPayloadPullRequestPullRequest
): Promise<File[]> {
  core.info(`Fetching list of changed files for PR#${pullRequest.number} from Github API`)
  const client = new github.GitHub(token)
  const pageSize = 100
  const files: File[] = []
  for (let page = 0; page * pageSize < pullRequest.changed_files; page++) {
    const response = await client.pulls.listFiles({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      pull_number: pullRequest.number,
      page,
      per_page: pageSize
    })
    for (const row of response.data) {
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
        files.push({
          filename: row.filename,
          status: row.status as ChangeStatus
        })
      }
    }
  }

  return files
}

function exportResults(results: FilterResults, format: ExportFormat): void {
  for (const [key, files] of Object.entries(results)) {
    const value = files.length > 0
    core.startGroup(`Filter ${key} = ${value}`)
    core.info('Matching files:')
    for (const file of files) {
      core.info(`${file.filename} [${file.status}]`)
    }

    core.setOutput(key, value)
    if (format !== 'none') {
      const filesValue = serializeExport(files, format)
      core.setOutput(`${key}_files`, filesValue)
    }
  }
  core.endGroup()
}

function serializeExport(files: File[], format: ExportFormat): string {
  const fileNames = files.map(file => file.filename)
  switch (format) {
    case 'json':
      return JSON.stringify(fileNames)
    case 'shell':
      return fileNames.map(shellEscape).join(' ')
    default:
      return ''
  }
}

function isExportFormat(value: string): value is ExportFormat {
  return value === 'none' || value === 'shell' || value === 'json'
}

run()
