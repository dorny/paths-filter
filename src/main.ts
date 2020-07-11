import * as fs from 'fs'
import * as core from '@actions/core'
import * as github from '@actions/github'
import {Webhooks} from '@octokit/webhooks'

import Filter from './filter'
import {File, ChangeStatus} from './file'
import * as git from './git'

interface Results {
  [key: string]: boolean
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
    const outputSeparator = core.getInput('output-separator', {required: false})

    const filter = new Filter(filtersYaml)
    const files = await getChangedFiles(token)
    let results: Results

    if (files === null) {
      core.info('All filters will be set to true.')
      results = {}
      for (const key of Object.keys(filter.rules)) {
        results[key] = true
      }
    } else {
      results = filter.match(files)
    }

    exportFiles(files ?? [], outputSeparator)
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
  if (github.context.eventName === 'pull_request') {
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
  return core.group(`Fetching ${ref} and using git \`git diff-index\` to determine changed files`, async () => {
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
  core.debug('Fetching list of modified files from Github API')
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

function exportFiles(files: File[], separator: string): void {
  const allChanged = files.map(f => f.filename).join(separator)
  core.setOutput('files_changed', allChanged)

  for (const status of Object.values(ChangeStatus)) {
    const group = files.filter(f => f.status === status)
    if (group.length > 0) {
      core.startGroup(`${status.toUpperCase()}`)
      const key = `files_${status}`
      const value = group.join(separator)
      for (const file of group) {
        core.info(file.filename)
      }
      core.setOutput(key, value)
      core.endGroup()
    }
  }
}

function exportResults(results: Results): void {
  core.startGroup('Filters results:')
  for (const [key, value] of Object.entries(results)) {
    core.info(`${key}: ${value}`)
    core.setOutput(key, value)
  }
  core.endGroup()
}

run()
