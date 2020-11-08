import {Filter} from '../src/filter'
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
