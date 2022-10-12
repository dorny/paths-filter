# Changelog

## v2.11.1
- [Update @actions/core to v1.10.0 - Fixes warning about deprecated set-output](https://github.com/dorny/paths-filter/pull/167)
- [Document need for pull-requests: read permission](https://github.com/dorny/paths-filter/pull/168)
- [Updating to actions/checkout@v3](https://github.com/dorny/paths-filter/pull/164)

## v2.11.0
- [Set list-files input parameter as not required](https://github.com/dorny/paths-filter/pull/157)
- [Update Node.js](https://github.com/dorny/paths-filter/pull/161)
- [Fix incorrect handling of Unicode characters in exec()](https://github.com/dorny/paths-filter/pull/162)
- [Use Octokit pagination](https://github.com/dorny/paths-filter/pull/163)
- [Updates real world links](https://github.com/dorny/paths-filter/pull/160)

## v2.10.2
- [Fix getLocalRef() returns wrong ref](https://github.com/dorny/paths-filter/pull/91)

## v2.10.1
- [Improve robustness of change detection](https://github.com/dorny/paths-filter/pull/85)

## v2.10.0
- [Add ref input parameter](https://github.com/dorny/paths-filter/pull/82)
- [Fix change detection in PR when pullRequest.changed_files is incorrect](https://github.com/dorny/paths-filter/pull/83)

## v2.9.3
- [Fix change detection when base is a tag](https://github.com/dorny/paths-filter/pull/78)

## v2.9.2
- [Fix fetching git history](https://github.com/dorny/paths-filter/pull/75)

## v2.9.1
- [Fix fetching git history + fallback to unshallow repo](https://github.com/dorny/paths-filter/pull/74)

## v2.9.0
- [Add list-files: csv format](https://github.com/dorny/paths-filter/pull/68)

## v2.8.0
- [Add count output variable](https://github.com/dorny/paths-filter/pull/65)
- [Fix log grouping of changes](https://github.com/dorny/paths-filter/pull/61)

## v2.7.0
- [Add "changes" output variable to support matrix job configuration](https://github.com/dorny/paths-filter/pull/59)
- [Improved listing of matching files with `list-files: shell` and `list-files: escape` options](https://github.com/dorny/paths-filter/pull/58)

## v2.6.0
- [Support local changes](https://github.com/dorny/paths-filter/pull/53)

## v2.5.3
- [Fixed mapping of removed/deleted change status from github API](https://github.com/dorny/paths-filter/pull/51)
- [Fixed retrieval of all changes via Github API when there are 100+ changes](https://github.com/dorny/paths-filter/pull/50)

## v2.5.2
- [Add support for multiple patterns when using file status](https://github.com/dorny/paths-filter/pull/48)
- [Use picomatch directly instead of micromatch wrapper](https://github.com/dorny/paths-filter/pull/49)

## v2.5.1
- [Improved path matching with micromatch](https://github.com/dorny/paths-filter/pull/46)

## v2.5.0
- [Support workflows triggered by any event](https://github.com/dorny/paths-filter/pull/44)

## v2.4.2
- [Fixed compatibility with older (<2.23) versions of git](https://github.com/dorny/paths-filter/pull/42)

## v2.4.0
- [Support pushes of tags or when tag is used as base](https://github.com/dorny/paths-filter/pull/40)
- [Use git log to detect changes from PRs merge commit if token is not available](https://github.com/dorny/paths-filter/pull/40)
- [Support local execution with act](https://github.com/dorny/paths-filter/pull/40)
- [Improved processing of repository initial push](https://github.com/dorny/paths-filter/pull/40)
- [Improved processing of first push of new branch](https://github.com/dorny/paths-filter/pull/40)


## v2.3.0
- [Improved documentation](https://github.com/dorny/paths-filter/pull/37)
- [Change detection using git "three dot" diff](https://github.com/dorny/paths-filter/pull/35)
- [Export files matching filter](https://github.com/dorny/paths-filter/pull/32)
- [Extend filter syntax with optional specification of file status: add, modified, deleted](https://github.com/dorny/paths-filter/pull/22)
- [Add working-directory input](https://github.com/dorny/paths-filter/pull/21)

## v2.2.1
- [Add support for pull_request_target](https://github.com/dorny/paths-filter/pull/29)

## v2.2.0
- [Improve change detection for feature branches](https://github.com/dorny/paths-filter/pull/16)

## v2.1.0
- [Support reusable paths blocks with yaml anchors](https://github.com/dorny/paths-filter/pull/13)

## v2.0.0
- [Added support for workflows triggered by push events](https://github.com/dorny/paths-filter/pull/10)
- Action and repository renamed to paths-filter - original name doesn't make sense anymore

## v1.1.0
- [Allows filters to be specified in own .yml file](https://github.com/dorny/paths-filter/pull/8)
- [Adds alternative change detection using git fetch and git diff-index](https://github.com/dorny/paths-filter/pull/9)

## v1.0.1
Updated dependencies - fixes github security alert

## v1.0.0
First official release uploaded to marketplace.
