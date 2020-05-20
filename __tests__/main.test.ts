import Filter from '../src/filter'

describe('yaml filter parsing tests', () => {
  test('throws if yaml is not a dictionary', () => {
    const yaml = 'not a dictionary'
    const t = () => new Filter(yaml)
    expect(t).toThrow(/^Invalid filter.*/)
  })
  test('throws on invalid yaml', () => {
    const yaml = `
    src:
      src/**/*.js
    `
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
  test('matches single rule in single group', () => {
    const yaml = `
    src:
      - src/**/*.js
    `
    const filter = new Filter(yaml)
    const match = filter.match(['src/app/module/file.js'])
    expect(match.src).toBeTruthy()
  })

  test('no match when file is in different folder', () => {
    const yaml = `
    src:
      - src/**/*.js
    `
    const filter = new Filter(yaml)
    const match = filter.match(['not_src/other_file.js'])
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
    const match = filter.match(['test/test.js'])
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
    const match = filter.match(['test/test.js'])
    expect(match.src).toBeTruthy()
  })
})
