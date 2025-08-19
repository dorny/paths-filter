import {Filter} from '../src/filter'
import {ChangeStatus} from '../src/file'

describe('sample filter usage', () => {
  test('matches files in sample folder', () => {
    const yaml = `
    sample:
      - sample/**
    `
    const filter = new Filter(yaml)
    const files = [{filename: 'sample/example.ts', status: ChangeStatus.Modified}]
    const match = filter.match(files)
    expect(match.sample).toEqual(files)
  })

  test('does not match files outside sample folder', () => {
    const yaml = `
    sample:
      - sample/**
    `
    const filter = new Filter(yaml)
    const files = [{filename: 'other/example.ts', status: ChangeStatus.Modified}]
    const match = filter.match(files)
    expect(match.sample).toEqual([])
  })
})
