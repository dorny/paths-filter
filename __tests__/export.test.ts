import * as core from '@actions/core'
import {Filter} from '../src/filter'
import {File, ChangeStatus} from '../src/file'
import {exportResults} from '../src/main'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  setFailed: jest.fn(),
  startGroup: jest.fn(),
  setOutput: jest.fn(),
  endGroup: jest.fn()
}))

describe('set output post filtering', () => {
  test('correctly sets output', () => {
    const yaml = `
    backend:
      - '!(**/*.tsx|**/*.less)'
    `
    const filter = new Filter(yaml)
    const files = modified(['config/settings.yml'])
    const match = filter.match(files)
    exportResults(match, 'none')

    expect(core.setOutput).toHaveBeenCalledWith('changes', '["backend"]')
  })
  test('correctly filters out shared from output', () => {
    const yaml = `
    shared: &shared
      - common/**/*
      - config/**/*
    src:
      - *shared
      - src/**/*
    backend:
      - '!(**/*.tsx|**/*.less)'
    `
    const filter = new Filter(yaml)
    const files = modified(['config/settings.yml'])
    const match = filter.match(files)
    exportResults(match, 'none')

    expect(core.setOutput).toHaveBeenCalledWith('changes', '["src","backend"]')
  })
})

function modified(paths: string[]): File[] {
  return paths.map(filename => {
    return {filename, status: ChangeStatus.Modified}
  })
}
