# Changelog

## v2.4.1
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
