import {Filter, FilterConfig, PredicateQuantifier} from '../src/filter'
import {File, ChangeStatus} from '../src/file'

describe('yaml filter parsing tests', () => {
  test('throws if yaml is not a dictionary', () => {
    const yaml = 'not a dictionary'
    const t = () => new Filter(yaml)
    expect(t).toThrow(/^Invalid filter.*/)
  })
  test('throws if pattern is not a string', () => {
    const yaml = `
    src:
      - src/**/*.js
      - dict:
          some: value
    `
    const t = () => new Filter(yaml)
    expect(t).toThrow(/^Invalid filter.*/)
  })
})

describe('matching tests', () => {
  test('matches single inline rule', () => {
    const yaml = `
    src: "src/**/*.js"
    `
    let filter = new Filter(yaml)
    const files = modified(['src/app/module/file.js'])
    const match = filter.match(files)
    expect(match.src).toEqual(files)
  })
  test('matches single rule in single group', () => {
    const yaml = `
    src:
      - src/**/*.js
    `
    const filter = new Filter(yaml)
    const files = modified(['src/app/module/file.js'])
    const match = filter.match(files)
    expect(match.src).toEqual(files)
  })

  test('no match when file is in different folder', () => {
    const yaml = `
    src:
      - src/**/*.js
    `
    const filter = new Filter(yaml)
    const match = filter.match(modified(['not_src/other_file.js']))
    expect(match.src).toEqual([])
  })

  test('match only within second groups ', () => {
    const yaml = `
    src:
      - src/**/*.js
    test:
      - test/**/*.js
    `
    const filter = new Filter(yaml)
    const files = modified(['test/test.js'])
    const match = filter.match(files)
    expect(match.src).toEqual([])
    expect(match.test).toEqual(files)
  })

  test('match only withing second rule of single group', () => {
    const yaml = `
    src:
      - src/**/*.js
      - test/**/*.js
    `
    const filter = new Filter(yaml)
    const files = modified(['test/test.js'])
    const match = filter.match(files)
    expect(match.src).toEqual(files)
  })

  test('matches anything', () => {
    const yaml = `
    any:
      - "**"
    `
    const filter = new Filter(yaml)
    const files = modified(['test/test.js'])
    const match = filter.match(files)
    expect(match.any).toEqual(files)
  })

  test('globbing matches path where file or folder name starts with dot', () => {
    const yaml = `
    dot:
      - "**/*.js"
    `
    const filter = new Filter(yaml)
    const files = modified(['.test/.test.js'])
    const match = filter.match(files)
    expect(match.dot).toEqual(files)
  })

  test('matches all except tsx and less files (negate a group with or-ed parts)', () => {
    const yaml = `
    backend:
      - '!(**/*.tsx|**/*.less)'
    `
    const filter = new Filter(yaml)
    const tsxFiles = modified(['src/ui.tsx'])
    const lessFiles = modified(['src/ui.less'])
    const pyFiles = modified(['src/server.py'])

    const tsxMatch = filter.match(tsxFiles)
    const lessMatch = filter.match(lessFiles)
    const pyMatch = filter.match(pyFiles)

    expect(tsxMatch.backend).toEqual([])
    expect(lessMatch.backend).toEqual([])
    expect(pyMatch.backend).toEqual(pyFiles)
  })

  test('matches only files that are matching EVERY pattern when set to PredicateQuantifier.EVERY', () => {
    const yaml = `
    backend:
      - 'pkg/a/b/c/**'
      - '!**/*.jpeg'
      - '!**/*.md'
    `
    const filterConfig: FilterConfig = {predicateQuantifier: PredicateQuantifier.EVERY}
    const filter = new Filter(yaml, filterConfig)

    const typescriptFiles = modified(['pkg/a/b/c/some-class.ts', 'pkg/a/b/c/src/main/some-class.ts'])
    const otherPkgTypescriptFiles = modified(['pkg/x/y/z/some-class.ts', 'pkg/x/y/z/src/main/some-class.ts'])
    const otherPkgJpegFiles = modified(['pkg/x/y/z/some-pic.jpeg', 'pkg/x/y/z/src/main/jpeg/some-pic.jpeg'])
    const docsFiles = modified([
      'pkg/a/b/c/some-pics.jpeg',
      'pkg/a/b/c/src/main/jpeg/some-pic.jpeg',
      'pkg/a/b/c/src/main/some-docs.md',
      'pkg/a/b/c/some-docs.md'
    ])

    const typescriptMatch = filter.match(typescriptFiles)
    const otherPkgTypescriptMatch = filter.match(otherPkgTypescriptFiles)
    const docsMatch = filter.match(docsFiles)
    const otherPkgJpegMatch = filter.match(otherPkgJpegFiles)

    expect(typescriptMatch.backend).toEqual(typescriptFiles)
    expect(otherPkgTypescriptMatch.backend).toEqual([])
    expect(docsMatch.backend).toEqual([])
    expect(otherPkgJpegMatch.backend).toEqual([])
  })

  test('ignores exclusions when using the default predicate quantifier', () => {
    const yaml = `
    src:
      - 'src/**'
      - '!**/*.md'
    `
    const filter = new Filter(yaml)

    // A negated pattern is just another pattern for the 'some' quantifier - a markdown file
    // inside 'src' still matches 'src/**' and any other file matches the negated pattern.
    const files = modified(['src/README.md', 'other/file.txt'])
    expect(filter.match(files).src).toEqual(files)
  })

  test('matches files of every pattern when set to PredicateQuantifier.SOME_WITH_EXCLUDES', () => {
    const yaml = `
    mobile:
      - 'mobile/**'
      - '!mobile/**/*.md'
      - '!mobile/.config/**'
      - '.github/workflows/test_mobile.yml'
    `
    const filterConfig: FilterConfig = {predicateQuantifier: PredicateQuantifier.SOME_WITH_EXCLUDES}
    const filter = new Filter(yaml, filterConfig)

    const sourceFiles = modified(['mobile/main.kt', 'mobile/src/some/Activity.kt'])
    const workflowFiles = modified(['.github/workflows/test_mobile.yml'])
    const docsFiles = modified(['mobile/README.md', 'mobile/docs/some/page.md'])
    const configFiles = modified(['mobile/.config/lint.json', 'mobile/.config/nested/lint.json'])
    const otherFiles = modified(['backend/main.go', '.github/workflows/test_backend.yml'])

    expect(filter.match(sourceFiles).mobile).toEqual(sourceFiles)
    expect(filter.match(workflowFiles).mobile).toEqual(workflowFiles)
    expect(filter.match(docsFiles).mobile).toEqual([])
    expect(filter.match(configFiles).mobile).toEqual([])
    expect(filter.match(otherFiles).mobile).toEqual([])
  })

  test('excludes file with PredicateQuantifier.SOME_WITH_EXCLUDES regardless of the pattern order', () => {
    const yaml = `
    excludeFirst:
      - '!**/*.md'
      - 'src/**'
    excludeLast:
      - 'src/**'
      - '!**/*.md'
    `
    const filterConfig: FilterConfig = {predicateQuantifier: PredicateQuantifier.SOME_WITH_EXCLUDES}
    const filter = new Filter(yaml, filterConfig)

    const match = filter.match(modified(['src/index.ts', 'src/README.md']))
    expect(match.excludeFirst).toEqual(modified(['src/index.ts']))
    expect(match.excludeLast).toEqual(modified(['src/index.ts']))
  })

  test('keeps file excluded with PredicateQuantifier.SOME_WITH_EXCLUDES even if a later pattern includes it', () => {
    const yaml = `
    src:
      - 'src/**'
      - '!**/*.md'
      - 'src/docs/**'
    `
    const filterConfig: FilterConfig = {predicateQuantifier: PredicateQuantifier.SOME_WITH_EXCLUDES}
    const filter = new Filter(yaml, filterConfig)

    const match = filter.match(modified(['src/docs/guide.md', 'src/docs/logo.png']))
    expect(match.src).toEqual(modified(['src/docs/logo.png']))
  })

  test('matches nothing with PredicateQuantifier.SOME_WITH_EXCLUDES when there is no include pattern', () => {
    const yaml = `
    src:
      - '!**/*.md'
    `
    const filterConfig: FilterConfig = {predicateQuantifier: PredicateQuantifier.SOME_WITH_EXCLUDES}
    const filter = new Filter(yaml, filterConfig)

    const match = filter.match(modified(['src/index.ts', 'src/README.md']))
    expect(match.src).toEqual([])
  })

  test('treats negated extglob as an include pattern with PredicateQuantifier.SOME_WITH_EXCLUDES', () => {
    const yaml = `
    backend:
      - '!(**/*.tsx|**/*.less)'
    `
    const filterConfig: FilterConfig = {predicateQuantifier: PredicateQuantifier.SOME_WITH_EXCLUDES}
    const filter = new Filter(yaml, filterConfig)

    expect(filter.match(modified(['src/server.py'])).backend).toEqual(modified(['src/server.py']))
    expect(filter.match(modified(['src/ui.tsx'])).backend).toEqual([])
  })

  test('matches path based on rules included using YAML anchor', () => {
    const yaml = `
    shared: &shared
      - common/**/*
      - config/**/*
    src:
      - *shared
      - src/**/*
    `
    const filter = new Filter(yaml)
    const files = modified(['config/settings.yml'])
    const match = filter.match(files)
    expect(match.src).toEqual(files)
  })
})

describe('matching specific change status', () => {
  test('does not match modified file as added', () => {
    const yaml = `
    add:
      - added: "**/*"
    `
    let filter = new Filter(yaml)
    const match = filter.match(modified(['file.js']))
    expect(match.add).toEqual([])
  })

  test('match added file as added', () => {
    const yaml = `
    add:
      - added: "**/*"
    `
    let filter = new Filter(yaml)
    const files = [{status: ChangeStatus.Added, filename: 'file.js'}]
    const match = filter.match(files)
    expect(match.add).toEqual(files)
  })

  test('matches when multiple statuses are configured', () => {
    const yaml = `
    addOrModify:
      - added|modified: "**/*"
    `
    let filter = new Filter(yaml)
    const files = [{status: ChangeStatus.Modified, filename: 'file.js'}]
    const match = filter.match(files)
    expect(match.addOrModify).toEqual(files)
  })

  test('respects change status of exclude patterns when set to PredicateQuantifier.SOME_WITH_EXCLUDES', () => {
    const yaml = `
    src:
      - 'src/**'
      - deleted: '!src/generated/**'
    `
    const filterConfig: FilterConfig = {predicateQuantifier: PredicateQuantifier.SOME_WITH_EXCLUDES}
    const filter = new Filter(yaml, filterConfig)

    const files = [
      {status: ChangeStatus.Deleted, filename: 'src/generated/api.ts'},
      {status: ChangeStatus.Modified, filename: 'src/generated/api.ts'}
    ]
    const match = filter.match(files)
    expect(match.src).toEqual([files[1]])
  })

  test('matches multiple patterns of single change status when set to PredicateQuantifier.SOME_WITH_EXCLUDES', () => {
    const yaml = `
    docs: &docs
      - '!**/*.md'
    src:
      - added|modified: 'src/**'
      - added|modified: *docs
    `
    const filterConfig: FilterConfig = {predicateQuantifier: PredicateQuantifier.SOME_WITH_EXCLUDES}
    const filter = new Filter(yaml, filterConfig)

    const files = [
      {status: ChangeStatus.Added, filename: 'src/index.ts'},
      {status: ChangeStatus.Added, filename: 'src/README.md'},
      {status: ChangeStatus.Deleted, filename: 'src/legacy.ts'}
    ]
    const match = filter.match(files)
    expect(match.src).toEqual([files[0]])
  })

  test('or-es patterns of single change status when using the default predicate quantifier', () => {
    const yaml = `
    src:
      - added|modified: ['src/**', '!**/*.md']
    `
    const filter = new Filter(yaml)

    // Both patterns are OR-ed into a single rule, therefore a markdown file inside 'src'
    // matches through 'src/**' and any other file matches through the negated pattern.
    const files = [
      {status: ChangeStatus.Added, filename: 'src/README.md'},
      {status: ChangeStatus.Added, filename: 'other/file.txt'},
      {status: ChangeStatus.Deleted, filename: 'src/index.ts'}
    ]
    const match = filter.match(files)
    expect(match.src).toEqual([files[0], files[1]])
  })

  test('matches when using an anchor', () => {
    const yaml = `
    shared: &shared
      - common/**/*
      - config/**/*
    src:
      - modified: *shared
    `
    let filter = new Filter(yaml)
    const files = modified(['config/file.js', 'common/anotherFile.js'])
    const match = filter.match(files)
    expect(match.src).toEqual(files)
  })
})

function modified(paths: string[]): File[] {
  return paths.map(filename => {
    return {filename, status: ChangeStatus.Modified}
  })
}

function renamed(paths: string[]): File[] {
  return paths.map(filename => {
    return {filename, status: ChangeStatus.Renamed}
  })
}
