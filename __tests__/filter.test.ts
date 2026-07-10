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

  test('throws when a rule contains only negation patterns', () => {
    const yaml = `
    excludes:
      - '!**/*.md'
      - '!**/*.txt'
    `
    expect(() => new Filter(yaml)).toThrow(/at least one positive pattern/)
  })

  test('throws when a status-tagged rule contains only negation patterns', () => {
    const yaml = `
    docs:
      - modified:
          - '!**/*.md'
    `
    expect(() => new Filter(yaml)).toThrow(/at least one positive pattern/)
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

  test('negation patterns under default quantifier exclude files instead of matching everything (issue #260)', () => {
    const yaml = `
    mobile:
      - 'mobile/**'
      - '!mobile/**/*.md'
      - '!mobile/.config/**'
      - '.github/workflows/test_mobile.yml'
    `
    const filter = new Filter(yaml)

    // Files outside the included path must NOT match purely because they are
    // not mobile markdown files. This was the original bug: a standalone
    // '!mobile/**/*.md' picomatch returned true for any non-markdown path,
    // and the default 'some' quantifier flipped the rule into a near-universal match.
    const unrelated = modified(['web/src/foo.tsx', 'docs/README.md', 'server/main.go'])
    expect(filter.match(unrelated).mobile).toEqual([])

    // Mobile sources should still match.
    const mobileSrc = modified(['mobile/src/app.ts', 'mobile/lib/index.ts'])
    expect(filter.match(mobileSrc).mobile).toEqual(mobileSrc)

    // Negated paths inside the include set must be excluded.
    const mobileExcluded = modified(['mobile/README.md', 'mobile/.config/eslint.json'])
    expect(filter.match(mobileExcluded).mobile).toEqual([])

    // The standalone workflow path must still match.
    const workflow = modified(['.github/workflows/test_mobile.yml'])
    expect(filter.match(workflow).mobile).toEqual(workflow)
  })

  test('negation across YAML anchors is honored under default quantifier', () => {
    const yaml = `
    shared: &shared
      - 'common/**'
      - '!**/*.md'
      - '!**/*.txt'
    src:
      - 'src/**'
      - *shared
    `
    const filter = new Filter(yaml)

    // Anchor-inherited positives still match.
    expect(filter.match(modified(['common/util.ts'])).src).toEqual(modified(['common/util.ts']))
    // The rule's own positive still matches.
    expect(filter.match(modified(['src/app.ts'])).src).toEqual(modified(['src/app.ts']))
    // Anchor-inherited negations exclude files even when a sibling positive matches.
    expect(filter.match(modified(['src/README.md'])).src).toEqual([])
    expect(filter.match(modified(['common/notes.txt'])).src).toEqual([])
    // Files outside every positive pattern do not match.
    expect(filter.match(modified(['other/file.ts'])).src).toEqual([])
  })

  test('status-tagged array honors negation patterns (issue #260, status form)', () => {
    const yaml = `
    src:
      - modified:
          - 'src/**'
          - '!src/**/*.md'
    `
    const filter = new Filter(yaml)
    const tsFile = modified(['src/app.ts'])
    const mdFile = modified(['src/README.md'])
    const unrelated = modified(['docs/intro.md'])
    expect(filter.match(tsFile).src).toEqual(tsFile)
    expect(filter.match(mdFile).src).toEqual([])
    expect(filter.match(unrelated).src).toEqual([])
  })

  test('mixing string patterns and status-tagged patterns still matches both forms', () => {
    const yaml = `
    backend:
      - 'src/**'
      - '!src/**/*.md'
      - added: 'migrations/**'
    `
    const filter = new Filter(yaml)

    expect(filter.match(modified(['src/server.ts'])).backend).toEqual(modified(['src/server.ts']))
    expect(filter.match(modified(['src/README.md'])).backend).toEqual([])
    const addedMigration: File[] = [{status: ChangeStatus.Added, filename: 'migrations/0001.sql'}]
    expect(filter.match(addedMigration).backend).toEqual(addedMigration)
    const modifiedMigration = modified(['migrations/0001.sql'])
    expect(filter.match(modifiedMigration).backend).toEqual([])
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
