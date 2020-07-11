import * as jsyaml from 'js-yaml'
import * as minimatch from 'minimatch'
import {File, ChangeStatus} from './file'

// Type definition of object we expect to load from YAML
interface FilterYaml {
  [name: string]: FilterItemYaml
}
type FilterItemYaml =
  | string // Filename pattern, e.g. "path/to/*.js"
  | {[changeTypes: string]: string} // Change status and filename, e.g. added|modified: "path/to/*.js"
  | FilterItemYaml[] // Supports referencing another rule via YAML anchor

// Minimatch options used in all matchers
const MinimatchOptions: minimatch.IOptions = {
  dot: true
}

// Internal representation of one item in named filter rule
// Created as simplified form of data in FilterItemYaml
interface FilterRuleItem {
  status?: ChangeStatus[] // Required change status of the matched files
  matcher: minimatch.IMinimatch // Matches the filename
}

export default class Filter {
  rules: {[key: string]: FilterRuleItem[]} = {}

  // Creates instance of Filter and load rules from YAML if it's provided
  constructor(yaml?: string) {
    if (yaml) {
      this.load(yaml)
    }
  }

  // Load rules from YAML string
  load(yaml: string): void {
    if (!yaml) {
      return
    }

    const doc = jsyaml.safeLoad(yaml) as FilterYaml
    if (typeof doc !== 'object') {
      this.throwInvalidFormatError('Root element is not an object')
    }

    for (const [key, item] of Object.entries(doc)) {
      this.rules[key] = this.parseFilterItemYaml(item)
    }
  }

  // Returns dictionary with match result per rule
  match(files: File[]): {[key: string]: boolean} {
    const result: {[key: string]: boolean} = {}
    for (const [key, patterns] of Object.entries(this.rules)) {
      const match = files.some(file =>
        patterns.some(
          rule => (rule.status === undefined || rule.status.includes(file.status)) && rule.matcher.match(file.filename)
        )
      )
      result[key] = match
    }
    return result
  }

  private parseFilterItemYaml(item: FilterItemYaml): FilterRuleItem[] {
    if (Array.isArray(item)) {
      return flat(item.map(i => this.parseFilterItemYaml(i)))
    }

    if (typeof item === 'string') {
      return [{status: undefined, matcher: new minimatch.Minimatch(item, MinimatchOptions)}]
    }

    if (typeof item === 'object') {
      return Object.entries(item).map(([key, pattern]) => {
        if (typeof key !== 'string' || typeof pattern !== 'string') {
          this.throwInvalidFormatError(
            `Expected [key:string]= pattern:string, but [${key}:${typeof key}]= ${pattern}:${typeof pattern} found`
          )
        }
        return {
          status: key
            .split('|')
            .map(x => x.trim())
            .filter(x => x.length > 0)
            .map(x => x.toLowerCase()) as ChangeStatus[],
          matcher: new minimatch.Minimatch(pattern, MinimatchOptions)
        }
      })
    }

    this.throwInvalidFormatError(`Unexpected element type '${typeof item}'`)
  }

  private throwInvalidFormatError(message: string): never {
    throw new Error(`Invalid filter YAML format: ${message}.`)
  }
}

// Creates a new array with all sub-array elements concatenated
// In future could be replaced by Array.prototype.flat (supported on Node.js 11+)
function flat<T>(arr: T[][]): T[] {
  return arr.reduce((acc, val) => acc.concat(val), [])
}
