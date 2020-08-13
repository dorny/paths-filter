import * as jsyaml from 'js-yaml'
import * as minimatch from 'minimatch'

export default class Filter {
  rules: {[key: string]: minimatch.IMinimatch[]} = {}

  constructor(yaml: string) {
    const doc = jsyaml.safeLoad(yaml)
    if (typeof doc !== 'object') {
      this.throwInvalidFormatError()
    }

    const opts: minimatch.IOptions = {
      dot: true
    }

    for (const name of Object.keys(doc)) {
      const patternsNode = doc[name]
      if (!Array.isArray(patternsNode)) {
        this.throwInvalidFormatError()
      }
      const patterns = flat(patternsNode) as string[]
      if (!patterns.every(x => typeof x === 'string')) {
        this.throwInvalidFormatError()
      }
      this.rules[name] = patterns.map(x => new minimatch.Minimatch(x, opts))
    }
  }

  // Returns dictionary with match result per rules group
  match(paths: string[]): {[key: string]: boolean} {
    const result: {[key: string]: boolean} = {}
    for (const [key, patterns] of Object.entries(this.rules)) {
      const match = paths.some(fileName => patterns.some(rule => rule.match(fileName)))
      result[key] = match
    }
    return result
  }
  // Returns dictionary with match result per rules group
  notMatch(paths: string[]): {[key: string]: boolean} {
    const result: {[key: string]: boolean} = {}
    for (const [key, patterns] of Object.entries(this.rules)) {
      const match = paths.some(fileName => patterns.every(rule => !rule.match(fileName)))
      result[key] = match
    }
    return result
  }
  private throwInvalidFormatError(): never {
    throw new Error('Invalid filter YAML format: Expected dictionary of string arrays')
  }
}

// Creates a new array with all sub-array elements recursively concatenated
// In future could be replaced by Array.prototype.flat (supported on Node.js 11+)
function flat(arr: any[]): any[] {
  return arr.reduce((acc, val) => acc.concat(Array.isArray(val) ? flat(val) : val), [])
}
