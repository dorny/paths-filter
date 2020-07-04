import Filter from '../src/filter'
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
    const match = filter.match(modified(['src/app/module/file.js']))
    expect(match.src).toBeTruthy()
  })
  test('matches single rule in single group', () => {
    const yaml = `
    src:
      - src/**/*.js
    `
    const filter = new Filter(yaml)
    const match = filter.match(modified(['src/app/module/file.js']))
    expect(match.src).toBeTruthy()
  })

  test('no match when file is in different folder', () => {
    const yaml = `
    src:
      - src/**/*.js
    `
    const filter = new Filter(yaml)
    const match = filter.match(modified(['not_src/other_file.js']))
    expect(match.src).toBeFalsy()
  })

  test('match only within second groups ', () => {
    const yaml = `
    src:
      - src/**/*.js
    test:
      - test/**/*.js
    `
    const filter = new Filter(yaml)
    const match = filter.match(modified(['test/test.js']))
    expect(match.src).toBeFalsy()
    expect(match.test).toBeTruthy()
  })

  test('match only withing second rule of single group', () => {
    const yaml = `
    src:
      - src/**/*.js
      - test/**/*.js
    `
    const filter = new Filter(yaml)
    const match = filter.match(modified(['test/test.js']))
    expect(match.src).toBeTruthy()
  })

  test('matches anything', () => {
    const yaml = `
    any:
      - "**/*"
    `
    const filter = new Filter(yaml)
    const match = filter.match(modified(['test/test.js']))
    expect(match.any).toBeTruthy()
  })

  test('globbing matches path where file or folder name starts with dot', () => {
    const yaml = `
    dot:
      - "**/*.js"
    `
    const filter = new Filter(yaml)
    const match = filter.match(modified(['.test/.test.js']))
    expect(match.dot).toBeTruthy()
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
    let filter = new Filter(yaml)
    const match = filter.match(modified(['config/settings.yml']))
    expect(match.src).toBeTruthy()
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
    expect(match.add).toBeFalsy()
  })

  test('match added file as added', () => {
    const yaml = `
    add:
      - added: "**/*"
    `
    let filter = new Filter(yaml)
    const match = filter.match([{status: ChangeStatus.Added, filename: 'file.js'}])
    expect(match.add).toBeTruthy()
  })
  test('matches when multiple statuses are configured', () => {
    const yaml = `
    addOrModify:
      - added|modified: "**/*"
    `
    let filter = new Filter(yaml)
    const match = filter.match([{status: ChangeStatus.Modified, filename: 'file.js'}])
    expect(match.addOrModify).toBeTruthy()
  })
})

function modified(paths: string[]): File[] {
  return paths.map(filename => {
    return {filename, status: ChangeStatus.Modified}
  })
}
