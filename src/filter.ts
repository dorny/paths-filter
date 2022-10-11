import * as jsyaml from 'js-yaml'
import picomatch from 'picomatch'
import {File, ChangeStatus} from './file'
// Type definition of object we expect to load from YAML
interface FilterYaml {
  [name: string]: FilterItemYaml
}
type FilterItemYaml = includesFilter | {paths: includesFilter; paths_ignore: excludesFilter} | FilterItemYaml[] // Supports referencing another rule via YAML anchor

type includesFilter =
  | string // Filename pattern, e.g. "path/to/*.js"
  | string[] // Array of filename patterns e.g. ["path/to/thing/**", "path/to/another/**"]
  | {[changeTypes: string]: string | string[]} // Change status and filename, e.g. added|modified: "path/to/*.js"

export type excludesFilter = string[] // Filename pattern, e.g. "path/to/*.js"

// Minimatch options used in all matchers
type matchoptions = {
  dot: boolean
  ignore: excludesFilter
}

// Internal representation of one item in named filter rule
// Created as simplified form of data in FilterItemYaml
interface FilterRuleItem {
  status?: ChangeStatus[] // Required change status of the matched files
  isMatch: (str: string) => boolean // Matches the filename
}

export interface FilterResults {
  [key: string]: File[]
}

export class Filter {
  rules: {[key: string]: FilterRuleItem[]} = {}
  // Creates instance of Filter and load rules from YAML if it's provided
  constructor(yaml?: string, globalIgnoreArray: excludesFilter = []) {
    if (yaml) {
      this.load(yaml, globalIgnoreArray)
    }
  }

  // Load rules from YAML string
  load(yaml: string, globalIgnoreArray: excludesFilter): void {
    const doc = jsyaml.load(yaml) as FilterYaml
    if (typeof doc !== 'object') {
      this.throwInvalidFormatError('Root element is not an object')
    }

    for (const [key, item] of Object.entries(doc)) {
      if (typeof key !== 'string') {
        this.throwInvalidFormatError(`Filter rule element at the root key: ${JSON.stringify(key)} must be a string.`)
      } else if (typeof item !== 'string' && !Array.isArray(item)) {
        this.throwInvalidFormatError(
          `Filter rules must only be an array or a single string but we got ${JSON.stringify(
            item
          )} type: ${typeof item} isarray?: ${Array.isArray(item)}`
        )
      }
      this.rules[key] = this.parseFilterItemYaml(item, [], globalIgnoreArray)
    }
  }

  match(files: File[]): FilterResults {
    const result: FilterResults = {}
    for (const [key, patterns] of Object.entries(this.rules)) {
      result[key] = files.filter(file => this.isMatch(file, patterns))
    }
    return result
  }

  private isMatch(file: File, patterns: FilterRuleItem[]): boolean {
    return patterns.some(
      rule => (rule.status === undefined || rule.status.includes(file.status)) && rule.isMatch(file.filename)
    )
  }

  private parseFilterItemYaml(
    item: FilterItemYaml,
    excludes: excludesFilter = [],
    globalIgnoreArray: excludesFilter
  ): FilterRuleItem[] {
    let MatchOptions: matchoptions = {dot: true, ignore: []}
    MatchOptions.ignore.push(...excludes, ...globalIgnoreArray)
    if (typeof item === 'string' || this.isStringsArray(item as string[])) {
      return [{status: undefined, isMatch: picomatch(item as string | string[], MatchOptions)}]
    }
    if (Array.isArray(item)) {
      return flat(item.map(i => this.parseFilterItemYaml(i, excludes, globalIgnoreArray)))
    }
    if (typeof item === 'object') {
      var len = Object.keys(item).length
      if (len == 2 && item.paths_ignore && item.paths) {
        return this.parseFilterItemYaml(item.paths, item.paths_ignore as excludesFilter, globalIgnoreArray)
      } else if (len == 1) {
        return Object.entries(item).map(([key, pattern]) => {
          if (
            typeof key !== 'string' ||
            (typeof pattern !== 'string' && (!Array.isArray(pattern) ? true : !this.isStringsArray(pattern)))
          ) {
            this.throwInvalidFormatError(
              `Expected [key:string]= pattern:string | string[], but [${key}:${typeof key}]= ${pattern}:${typeof pattern} Where pattern isArray:${Array.isArray(
                pattern
              )} isArrayofStrings:${this.isStringsArray(pattern)} found.`
            )
          }
          return {
            status: key
              .split('|')
              .map(x => x.trim())
              .filter(x => x.length > 0)
              .map(x => this.isChangeStatus(x) && x.toLowerCase()) as ChangeStatus[],
            isMatch: picomatch(pattern as string | string[], MatchOptions)
          }
        })
      } else {
        this.throwInvalidFormatError(
          `Expected a filter rule object with keys paths & paths_ignore, or a single key for change status filter. Instead object keys: ${JSON.stringify(
            Object.keys(item)
          )} found.`
        )
      }
    }

    this.throwInvalidFormatError(`Unexpected element type '${typeof item}'`)
  }

  private isStringsArray(arr: any) {
    if (Array.isArray(arr) ? arr.every(i => typeof i === 'string') : false) {
      return true
    }
  }

  private isChangeStatus(test: string): test is ChangeStatus {
    if (Object.values(ChangeStatus).includes(test as ChangeStatus)) {
      return true
    }
    this.throwInvalidFormatError(
      `Change Status Filter Validation: Expected one of ${JSON.stringify(
        Object.values(ChangeStatus)
      )}, instead ${test} found.`
    )
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
