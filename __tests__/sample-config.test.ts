import * as fs from 'fs'
import * as path from 'path'
import {Filter} from '../src/filter'
import {ChangeStatus} from '../src/file'

describe('sample configuration file', () => {
  test('parses filter rules from sample file', () => {
    const yamlPath = path.join(__dirname, 'fixtures', 'sample-filter.yml')
    const yaml = fs.readFileSync(yamlPath, 'utf8')
    const filter = new Filter(yaml)
    const files = [{filename: 'src/index.ts', status: ChangeStatus.Modified}]
    const match = filter.match(files)
    expect(match.sample).toEqual(files)
  })
})
