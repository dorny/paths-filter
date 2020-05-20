import * as core from '@actions/core'
import * as github from '@actions/github'
import {Webhooks} from '@octokit/webhooks'

import Filter from './filter'

async function run(): Promise<void> {
  try {
    const token = core.getInput('githubToken', {required: true})
    const filterYaml = core.getInput('filters', {required: true})
    const client = new github.GitHub(token)

    if (github.context.eventName !== 'pull_request') {
      core.setFailed('This action can be triggered only by pull_request event')
      return
    }

    const pr = github.context.payload.pull_request as Webhooks.WebhookPayloadPullRequestPullRequest
    const filter = new Filter(filterYaml)
    const files = await getChangedFiles(client, pr)

    const result = filter.match(files)
    for (const key in result) {
      core.setOutput(key, String(result[key]))
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

// Uses github REST api to get list of files changed in PR
async function getChangedFiles(
  client: github.GitHub,
  pullRequest: Webhooks.WebhookPayloadPullRequestPullRequest
): Promise<string[]> {
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
