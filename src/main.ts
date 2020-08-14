import * as fs from 'fs'
import * as core from '@actions/core'
import * as github from '@actions/github'
import {Webhooks} from '@octokit/webhooks'

import Filter from './filter'
import {File, ChangeStatus} from './file'
import * as git from './git'

interface FilterResults {
  [key: string]: boolean
}
interface ActionOutput {
  [key: string]: string[]
}

async function run(): Promise<void> {
  try {
    const workingDirectory = core.getInput('working-directory', {required: false})
    if (workingDirectory) {
      process.chdir(workingDirectory)
    }

    const token = core.getInput('token', {required: false})
    const filtersInput = core.getInput('filters', {required: true})
    const filtersYaml = isPathInput(filtersInput) ? getConfigFileContent(filtersInput) : filtersInput

    const filter = new Filter(filtersYaml)
    const files = await getChangedFiles(token)
    let results: FilterResults

    if (files === null) {
      // Change detection was not possible
      core.info('All filters will be set to true.')
      results = {}
      for (const key of Object.keys(filter.rules)) {
        results[key] = true
      }
    } else {
      results = filter.match(files)
    }

    exportFiles(files ?? [])
    exportResults(results)
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

async function getChangedFiles(token: string): Promise<File[] | null> {
  if (github.context.eventName === 'pull_request' || github.context.eventName === 'pull_request_target') {
    const pr = github.context.payload.pull_request as Webhooks.WebhookPayloadPullRequestPullRequest
    return token ? await getChangedFilesFromApi(token, pr) : await getChangedFilesFromGit(pr.base.sha)
  } else if (github.context.eventName === 'push') {
    return getChangedFilesFromPush()
  } else {
    throw new Error('This action can be triggered only by pull_request or push event')
  }
}

async function getChangedFilesFromPush(): Promise<File[] | null> {
  const push = github.context.payload as Webhooks.WebhookPayloadPush

  // No change detection for pushed tags
  if (git.isTagRef(push.ref)) {
    core.info('Workflow is triggered by pushing of tag. Change detection will not run.')
    return null
  }

  // Get base from input or use repo default branch.
  // It it starts with 'refs/', it will be trimmed (git fetch refs/heads/<NAME> doesn't work)
  const baseInput = git.trimRefs(core.getInput('base', {required: false}) || push.repository.default_branch)

  // If base references same branch it was pushed to, we will do comparison against the previously pushed commit.
  // Otherwise changes are detected against the base reference
  const base = git.trimRefsHeads(baseInput) === git.trimRefsHeads(push.ref) ? push.before : baseInput

  // There is no previous commit for comparison
  // e.g. change detection against previous commit of just pushed new branch
  if (base === git.NULL_SHA) {
    core.info('There is no previous commit for comparison. Change detection will not run.')
    return null
  }

  return await getChangedFilesFromGit(base)
}

// Fetch base branch and use `git diff` to determine changed files
async function getChangedFilesFromGit(ref: string): Promise<File[]> {
  return core.group(`Fetching base and using \`git diff-index\` to determine changed files`, async () => {
    await git.fetchCommit(ref)
    // FETCH_HEAD will always point to the just fetched commit
    // No matter if ref is SHA, branch or tag name or full git ref
    return await git.getChangedFiles(git.FETCH_HEAD)
  })
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

function exportFiles(files: File[]): void {
  const output: ActionOutput = {}
  output[ChangeStatus.Added] = []
  output[ChangeStatus.Deleted] = []
  output[ChangeStatus.Modified] = []

  for (const file of files) {
    const arr = output[file.status] ?? []
    arr.push(file.filename)
    output[file.status] = arr
  }
  core.setOutput('files', output)

  // Files grouped by status
  for (const [status, paths] of Object.entries(output)) {
    core.startGroup(`${status.toUpperCase()} files:`)
    for (const filename of paths) {
      core.info(filename)
    }
    core.endGroup()
  }
}

function exportResults(results: FilterResults): void {
  core.startGroup('Filters results:')
  for (const [key, value] of Object.entries(results)) {
    core.info(`${key}: ${value}`)
    core.setOutput(key, value)
  }
  core.endGroup()
}

run()
