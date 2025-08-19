import {ChangeStatus} from '../src/file'
import {exportResults} from '../src/main'
import * as core from '@actions/core'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  startGroup: jest.fn(),
  endGroup: jest.fn(),
  setOutput: jest.fn()
}))

describe('exportResults file listing formats', () => {
  const files = [
    {filename: 'simple.txt', status: ChangeStatus.Modified},
    {filename: 'file with space.txt', status: ChangeStatus.Added}
  ]
  const results = {sample: files}

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('exports csv formatted list', () => {
    exportResults(results, 'csv')
    expect(core.setOutput).toHaveBeenCalledWith('sample_files', 'simple.txt,"file with space.txt"')
  })

  test('exports json formatted list', () => {
    exportResults(results, 'json')
    expect(core.setOutput).toHaveBeenCalledWith('sample_files', JSON.stringify(['simple.txt', 'file with space.txt']))
  })

  test('exports shell escaped list', () => {
    exportResults(results, 'shell')
    expect(core.setOutput).toHaveBeenCalledWith('sample_files', "simple.txt 'file with space.txt'")
  })

  test('exports escape formatted list', () => {
    exportResults(results, 'escape')
    expect(core.setOutput).toHaveBeenCalledWith('sample_files', 'simple.txt file\\ with\\ space.txt')
  })
})
