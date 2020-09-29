
# paths-filter

This [Github Action](https://github.com/features/actions) enables conditional execution of workflow steps and jobs,
based on the files modified by pull request, feature branch or in pushed commits.

It saves time and resources especially in monorepo setups, where you can run slow tasks (e.g. integration tests or deployments) only for changed components.
Github workflows built-in [path filters](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions#onpushpull_requestpaths)
doesn't allow this because they doesn't work on a level of individual jobs or steps.


## Supported workflows:
- Pull requests:
  - Action triggered by **[pull_request](https://docs.github.com/en/actions/reference/events-that-trigger-workflows#pull_request)**
    or **[pull_request_target](https://docs.github.com/en/actions/reference/events-that-trigger-workflows#pull_request_target)** event
  - Changes are detected against the pull request base branch
  - Uses Github REST API to fetch list of modified files
- Feature branches:
  - Action triggered by **[push](https://docs.github.com/en/actions/reference/events-that-trigger-workflows#push)** event
  - Changes are detected against the merge-base with configured base branch
  - Uses git commands to detect changes - repository must be already [checked out](https://github.com/actions/checkout)
- Master, Release or other long-lived branches:
  - Action triggered by **[push](https://docs.github.com/en/actions/reference/events-that-trigger-workflows#push)** event
  - Changes are detected against the most recent commit on the same branch before the push
  - Uses git commands to detect changes - repository must be already [checked out](https://github.com/actions/checkout)


## Important notes:
- Paths expressions are evaluated using [minimatch](https://github.com/isaacs/minimatch) library.
  Documentation for path expression format can be found on project github page.
- Minimatch [dot](https://www.npmjs.com/package/minimatch#dot) option is set to true.
  Globbing will match also paths where file or folder name starts with a dot.
- It's recommended to quote your path expressions with `'` or `"`. Otherwise you will get an error if it starts with `*`.


# What's New
- Support for tag pushes and tags as a base reference
- Fixes for various edge cases when event payload is incomplete
  - Now works locally with [act](https://github.com/nektos/act)
- Fixed behavior of feature branch workflow:
  - Detects only changes introduced by feature branch. Later modifications on base branch are ignored.
- Filter by type of file change:
  - Optionally consider if file was added, modified or deleted
- Custom processing of changed files:
  - Optionally export paths of all files matching the filter
  - Output can be space-delimited or in JSON format
- Improved documentation and logging

For more information see [CHANGELOG](https://github.com/actions/checkout/blob/main/CHANGELOG.md)

# Usage

```yaml
- uses: dorny/paths-filter@v2
  with:
    # Defines filters applied to detected changed files.
    # Each filter has a name and list of rules.
    # Rule is a glob expression - paths of all changed
    # files are matched against it.
    # Rule can optionally specify if the file
    # should be added, modified or deleted.
    # For each filter there will be corresponding output variable to
    # indicate if there's a changed file matching any of the rules.
    # Optionally there can be a second output variable
    # set to list of all files matching the filter.
    # Filters can be provided inline as a string (containing valid YAML document)
    # or as a relative path to separate file (e.g.: .github/filters.yaml).
    # Multiline string is evaluated as embedded filter definition,
    # single line string is evaluated as relative path to separate file.
    # Filters syntax is documented by example - see examples section.
    filters: ''

    # Branch or tag against which the changes will be detected.
    # If it references same branch it was pushed to,
    # changes are detected against the most recent commit before the push.
    # Otherwise it uses git merge-base to find best common ancestor between
    # current branch (HEAD) and base.
    # When merge-base is found, it's used for change detection - only changes
    # introduced by current branch are considered.
    # All files are considered as added if there is no common ancestor with
    # base branch or no previous commit.
    # This option is ignored if action is triggered by pull_request event.
    # Default: repository default branch (e.g. master)
    base: ''

    # How many commits are initially fetched from base branch.
    # If needed, each subsequent fetch doubles the
    # previously requested number of commits until the merge-base
    # is found or there are no more commits in the history.
    # This option takes effect only when changes are detected
    # using git against base branch (feature branch workflow).
    # Default: 20
    initial-fetch-depth: ''

    # Enables listing of files matching the filter:
    #   'none'  - Disables listing of matching files (default).
    #   'json'  - Matching files paths are formatted as JSON array.
    #   'shell' - Matching files paths are escaped and space-delimited.
    #             Output is usable as command line argument list in linux shell.
    # Default: none
    list-files: ''

    # Relative path under $GITHUB_WORKSPACE where the repository was checked out.
    working-directory: ''

    # Personal access token used to fetch list of changed files
    # from Github REST API.
    # It's used only if action is triggered by pull request event.
    # Github token from workflow context is used as default value.
    # If empty string is provided, action falls back to detect
    # changes using git commands.
    # Default: ${{ github.token }}
    token: ''
```

## Outputs
- For each filter it sets output variable named by the filter to the text:
   - `'true'` - if **any** of changed files matches any of filter rules
   - `'false'` - if **none** of changed files matches any of filter rules
- If enabled, for each filter it sets output variable with name `${FILTER_NAME}_files`. It will contain list of all files matching the filter.

# Examples

## Conditional execution

<details>
  <summary>Execute <b>step</b> in a workflow job only if some file in a subfolder is changed</summary>

```yaml
jobs:
  tests:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2
    - uses: dorny/paths-filter@v2
      id: filter
      with:
        filters: |
          backend:
            - 'backend/**'
          frontend:
            - 'frontend/**'

    # run only if 'backend' files were changed
    - name: backend tests
      if: steps.filter.outputs.backend == 'true'
      run: ...

    # run only if 'frontend' files were changed
    - name: frontend tests
      if: steps.filter.outputs.frontend == 'true'
      run: ...

    # run if 'backend' or 'frontend' files were changed
    - name: e2e tests
      if: steps.filter.outputs.backend == 'true' || steps.filter.outputs.frontend == 'true'
      run: ...
```
</details>

<details>
  <summary>Execute <b>job</b> in a workflow only if some file in a subfolder is changed</summary>

```yml
jobs:
  # JOB to run change detection
  changes:
    runs-on: ubuntu-latest
    # Set job outputs to values from filter step
    outputs:
      backend: ${{ steps.filter.outputs.backend }}
      frontend: ${{ steps.filter.outputs.frontend }}
    steps:
    # For pull requests it's not necessary to checkout the code
    - uses: dorny/paths-filter@v2
      id: filter
      with:
        filters: |
          backend:
            - 'backend/**'
          frontend:
            - 'frontend/**'

  # JOB to build and test backend code
  backend:
    needs: changes
    if: ${{ needs.changes.outputs.backend == 'true' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - ...

  # JOB to build and test frontend code
  frontend:
    needs: changes
    if: ${{ needs.changes.outputs.frontend == 'true' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - ...
```
</details>

## Change detection workflows

<details>
  <summary><b>Pull requests:</b> Detect changes against PR base branch</summary>

```yaml
on:
  pull_request:
    branches: # PRs to following branches will trigger the workflow
      - master
      - develop
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2
    - uses: dorny/paths-filter@v2
      id: filter
      with:
        filters: ... # Configure your filters
```
</details>

<details>
  <summary><b>Feature branch:</b> Detect changes against configured base branch</summary>

```yaml
on:
  push:
    branches: # Push to following branches will trigger the workflow
      - feature/**
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2
      with:
        # This may save additional git fetch roundtrip if
        # merge-base is found within latest 20 commits
        fetch-depth: 20
    - uses: dorny/paths-filter@v2
      id: filter
      with:
        base: develop # Change detection against merge-base with this branch
        filters: ... # Configure your filters
```
</details>

<details>
  <summary><b>Long lived branches:</b> Detect changes against the most recent commit on the same branch before the push</summary>

```yaml
on:
  push:
    branches: # Push to following branches will trigger the workflow
      - master
      - develop
      - release/**
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2
    - uses: dorny/paths-filter@v2
      id: filter
      with:
        # Use context to get branch where commits were pushed.
        # If there is only one long lived branch (e.g. master),
        # you can specify it directly.
        # If it's not configured, the repository default branch is used.
        base: ${{ github.ref }}
        filters: ... # Configure your filters
```
</details>

## Advanced options

<details>
  <summary>Define filter rules in own file</summary>

```yaml
- uses: dorny/paths-filter@v2
      id: filter
      with:
        # Path to file where filters are defined
        filters: .github/filters.yaml
```
</details>

<details>
  <summary>Use YAML anchors to reuse path expression(s) inside another rule</summary>

```yaml
- uses: dorny/paths-filter@v2
      id: filter
      with:
        # &shared is YAML anchor,
        # *shared references previously defined anchor
        # src filter will match any path under common, config and src folders
        filters: |
          shared: &shared
            - common/**
            - config/**
          src:
            - *shared
            - src/**
```
</details>

<details>
  <summary>Consider if file was added, modified or deleted</summary>

```yaml
- uses: dorny/paths-filter@v2
      id: filter
      with:
        # Changed file can be 'added', 'modified', or 'deleted'.
        # By default the type of change is not considered.
        # Optionally it's possible to specify it using nested
        # dictionary, where type(s) of change composes the key.
        # Multiple change types can be specified using `|` as delimiter.
        filters: |
          addedOrModified:
            - added|modified: '**'
          allChanges:
            - added|deleted|modified: '**'
```
</details>


## Custom processing of changed files

<details>
  <summary>Passing list of modified files as command line args in Linux shell</summary>

```yaml
- uses: dorny/paths-filter@v2
  id: filter
  with:
    # Enable listing of files matching each filter.
    # Paths to files will be available in `${FILTER_NAME}_files` output variable.
    # Paths will be escaped and space-delimited.
    # Output is usable as command line argument list in linux shell
    list-files: shell

    # In this example changed files will be checked by linter.
    # It doesn't make sense to lint deleted files.
    # Therefore we specify we are only interested in added or modified files.
    filters: |
      markdown:
        - added|modified: '*.md'
- name: Lint Markdown
  if: ${{ steps.filter.outputs.markdown == 'true' }}
  run: npx textlint ${{ steps.filter.outputs.markdown_files }}
```
</details>

<details>
  <summary>Passing list of modified files as JSON array to another action</summary>

```yaml
- uses: dorny/paths-filter@v2
  id: filter
  with:
    # Enable listing of files matching each filter.
    # Paths to files will be available in `${FILTER_NAME}_files` output variable.
    # Paths will be formatted as JSON array
    list-files: json

    # In this example all changed files are passed to following action to do
    # some custom processing.
    filters: |
      changed:
        - '**'
- name: Lint Markdown
  uses: johndoe/some-action@v1
  with:
    files: ${{ steps.filter.changed_files }}
```
</details>


# License

The scripts and documentation in this project are released under the [MIT License](https://github.com/dorny/paths-filter/blob/master/LICENSE)
