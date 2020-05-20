import * as jsyaml from 'js-yaml'
import * as minimatch from 'minimatch'

export default class Filter {
  rules: {[key: string]: minimatch.IMinimatch[]} = {}

  constructor(yaml: string) {
    const doc = jsyaml.safeLoad(yaml)
    if (typeof doc !== 'object') {
      this.throwInvalidFormatError()
    }

    for (const name of Object.keys(doc)) {
      const patterns = doc[name] as string[]
      if (!Array.isArray(patterns)) {
        this.throwInvalidFormatError()
      }
      if (!patterns.every(x => typeof x === 'string')) {
        this.throwInvalidFormatError()
      }
      this.rules[name] = patterns.map(x => new minimatch.Minimatch(x))
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

  private throwInvalidFormatError(): never {
    throw new Error('Invalid filter YAML format: Expected dictionary of string arrays')
  }
}
