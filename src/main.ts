import * as fs from 'fs'
import * as core from '@actions/core'
import * as github from '@actions/github'
import {Webhooks} from '@octokit/webhooks'

import Filter from './filter'
import * as git from './git'

async function run(): Promise<void> {
  try {
    const token = core.getInput('token', {required: false})
    const filtersInput = core.getInput('filters', {required: true})
    const filtersYaml = isPathInput(filtersInput) ? getConfigFileContent(filtersInput) : filtersInput

    const filter = new Filter(filtersYaml)
    const files = await getChangedFiles(token)

    if (files === null) {
      // Change detection was not possible
      // Set all filter keys to true (i.e. changed)
      for (const key in filter.rules) {
        core.setOutput(key, String(true))
      }
    } else {
      const result = filter.match(files)
      for (const key in result) {
        core.setOutput(key, String(result[key]))
      }
    }
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

async function getChangedFiles(token: string): Promise<string[] | null> {
  if (github.context.eventName === 'pull_request') {
    const pr = github.context.payload.pull_request as Webhooks.WebhookPayloadPullRequestPullRequest
    return token ? await getChangedFilesFromApi(token, pr) : await getChangedFilesFromGit(pr.base.sha)
  } else if (github.context.eventName === 'push') {
    return getChangedFilesFromPush()
  } else {
    throw new Error('This action can be triggered only by pull_request or push event')
  }
}

async function getChangedFilesFromPush(): Promise<string[] | null> {
  const push = github.context.payload as Webhooks.WebhookPayloadPush

  // No change detection for pushed tags
  if (git.isTagRef(push.ref)) return null

  // Get base from input or use repo default branch.
  // It it starts with 'refs/', it will be trimmed (git fetch refs/heads/<NAME> doesn't work)
  const baseInput = git.trimRefs(core.getInput('base', {required: false}) || push.repository.default_branch)

  // If base references same branch it was pushed to, we will do comparison against the previously pushed commit.
  // Otherwise changes are detected against the base reference
  const base = git.trimRefsHeads(baseInput) === git.trimRefsHeads(push.ref) ? push.before : baseInput

  // There is no previous commit for comparison
  // e.g. change detection against previous commit of just pushed new branch
  if (base === git.NULL_SHA) return null

  return await getChangedFilesFromGit(base)
}

// Fetch base branch and use `git diff` to determine changed files
async function getChangedFilesFromGit(ref: string): Promise<string[]> {
  core.debug('Fetching base branch and using `git diff-index` to determine changed files')
  await git.fetchCommit(ref)
  // FETCH_HEAD will always point to the just fetched commit
  // No matter if ref is SHA, branch or tag name or full git ref
  return await git.getChangedFiles(git.FETCH_HEAD)
}

// Uses github REST api to get list of files changed in PR
async function getChangedFilesFromApi(
  token: string,
  pullRequest: Webhooks.WebhookPayloadPullRequestPullRequest
): Promise<string[]> {
  core.debug('Fetching list of modified files from Github API')
  const client = new github.GitHub(token)
  const pageSize = 100
  const files: string[] = []
  for (let page = 0; page * pageSize < pullRequest.changed_files; page++) {
    const response = await client.pulls.listFiles({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      pull_number: pullRequest.number,
      page,
      per_page: pageSize
    })
    for (const row of response.data) {
      files.push(row.filename)
    }
  }

  return files
}

run()
