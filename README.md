<p align="center">
  <a href="https://github.com/dorny/paths-filter/actions"><img alt="paths-filter status" src="https://github.com/dorny/paths-filter/workflows/Build/badge.svg"></a>
</p>

# Paths filter

With this [Github Action](https://github.com/features/actions) you can execute your workflow steps only if relevant files are modified.

It saves time and resources especially in monorepo setups, where you can run slow tasks (e.g. integration tests or deployments) only for changed components.
Github workflows built-in [path filters](https://help.github.com/en/actions/referenceworkflow-syntax-for-github-actions#onpushpull_requestpaths)
doesn't allow this because they doesn't work on a level of individual jobs or steps.

Action supports workflows triggered by:
- Pull request: changes are detected against the base branch
- Push: changes are detected against the most recent commit on the same branch before the push

## Usage

Filter rules are defined using YAML format.
Each filter rule is a list of [glob expressions](https://github.com/isaacs/minimatch).
Corresponding output variable will be created to indicate if there's a changed file matching any of the rule glob expressions.
Output variables can be later used in the `if` clause to conditionally run specific steps.

### Inputs
- **`token`**: GitHub Access Token - defaults to `${{ github.token }}`
- **`filters`**: Path to the configuration file or directly embedded string in YAML format. Filter configuration is a dictionary, where keys specifies rule names and values are lists of file path patterns.

### Outputs
- For each rule it sets output variable named by the rule to text:
   - `'true'` - if **any** of changed files matches any of rule patterns
   - `'false'` - if **none** of changed files matches any of rule patterns

### Notes
- minimatch [dot](https://www.npmjs.com/package/minimatch#dot) option is set to true - therefore
  globbing will match also paths where file or folder name starts with a dot.

### Example
```yaml
on:
  push:
    branches:
      - master
  pull_request:
    types:
      - opened
      - synchronize
    branches:
      - master
jobs:
  tests:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2
    - uses: dorny/paths-filter@v2.0.0
      id: filter
      with:
        # inline YAML or path to separate file (e.g.: .github/filters.yaml)
        filters: |
          backend:
            - 'backend/**/*'
          frontend:
            - 'frontend/**/*'

    # run only if 'backend' files were changed
    - name: backend unit tests
      if: steps.filter.outputs.backend == 'true'
      run: ...

    # run only if 'frontend' files were changed
    - name: frontend unit tests
      if: steps.filter.outputs.frontend == 'true'
      run: ...

    # run if 'backend' or 'frontend' files were changed
    - name: e2e tests
      if: steps.filter.outputs.backend == 'true' || steps.filter.outputs.frontend == 'true'
      run: ...
```

## How it works

1. If action was triggered by pull request:
   - If access token was provided it's used to fetch list of changed files from Github API.
   - If access token was not provided, top of the base branch is fetched and changed files are detected using `git diff-index` command.
2. If action was triggered by push event
   - Last commit before the push is fetched and changed files are detected using `git diff-index` command.
3. For each filter rule it checks if there is any matching file
4. Output variables are set

## Difference from similar projects:

- [Has Changed Path](https://github.com/MarceloPrado/has-changed-path)
  - detects changes from previous commit
  - you have to configure `checkout` action to fetch some number of previous commits
  - outputs only single `true` / `false` value if any of provided paths contains changes
- [Changed Files Exporter](https://github.com/futuratrepadeira/changed-files)
  - outputs lists with paths of created, updated and deleted files
  - output is not directly usable in the `if` clause
- [Changed File Filter](https://github.com/tony84727/changed-file-filter)
  - allows change detection between any refs or commits
  - fetches whole history of your git repository
  - might have negative performance impact on big repositories (github by default fetches only single commit)
