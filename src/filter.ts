import * as jsyaml from 'js-yaml'
import micromatch from 'micromatch'

import {File} from './file'

// Type definition of object we expect to load from YAML
type FilterYaml = Record<string, FilterItemYaml>
type FilterItemYaml =
  | string // Filename pattern, e.g. "path/to/*.js"
  | FilterItemYaml[] // Supports referencing another rule via YAML anchor

// Micromatch options used in all matchers
const MatchOptions: micromatch.Options = {
  dot: true
}

export type FilterResults = Partial<Record<string, File[]>>

export class Filter {
  rules: Record<string, string[]> = {}

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

    const doc = jsyaml.load(yaml) as FilterYaml
    if (typeof doc !== 'object') {
      this.throwInvalidFormatError('Root element is not an object')
    }

    for (const [key, item] of Object.entries(doc)) {
      this.rules[key] = this.getPatterns(item)
    }
  }

  match(files: File[]): FilterResults {
    const result: FilterResults = {}
    const filesMap = files.reduce((fileResult, x) => {
      fileResult.set(x.filename, x)
      return fileResult
    }, new Map<string, File>())

    for (const [key, patterns] of Object.entries(this.rules)) {
      const matchingFileNames = micromatch([...filesMap.keys()], patterns, MatchOptions)
      result[key] = matchingFileNames.map(x => filesMap.get(x)).filter((x): x is File => !!x)
    }

    return result
  }

  private getPatterns(item: FilterItemYaml): string[] {
    if (Array.isArray(item)) {
      return flat(item.map(i => this.getPatterns(i)))
    }

    if (typeof item === 'string') {
      return [item]
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
