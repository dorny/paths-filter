import * as jsyaml from 'js-yaml'
import picomatch from 'picomatch'
import {File, ChangeStatus} from './file'

// Type definition of object we expect to load from YAML
interface FilterYaml {
  [name: string]: FilterItemYaml
}
type FilterItemYaml =
  | string // Filename pattern, e.g. "path/to/*.js"
  | {[changeTypes: string]: string | string[]} // Change status and filename, e.g. added|modified: "path/to/*.js"
  | FilterItemYaml[] // Supports referencing another rule via YAML anchor

// Minimatch options used in all matchers
const MatchOptions = {
  dot: true
}

// Internal representation of one item in named filter rule
// Created as simplified form of data in FilterItemYaml
interface FilterRuleItem {
  status?: ChangeStatus[] // Required change status of the matched files
  isMatch: (str: string) => boolean // Matches the filename
  // Matchers for the individual polarities of the patterns this item was created from.
  // They are used only by the PredicateQuantifier.SOME_WITH_EXCLUDES quantifier,
  // which has to tell inclusions and exclusions apart. The other quantifiers keep
  // evaluating the item as a whole via 'isMatch'.
  isInclude?: (str: string) => boolean // Matches any of the patterns which are not negated
  isExclude?: (str: string) => boolean // Matches any of the patterns which are negated (e.g. '!**/*.md')
}

/**
 * Enumerates the possible logic quantifiers that can be used when determining
 * if a file is a match or not with multiple patterns.
 *
 * The YAML configuration property that is parsed into one of these values is
 * 'predicate-quantifier' on the top level of the configuration object of the
 * action.
 *
 * The default is to use 'some' which used to be the hardcoded behavior prior to
 * the introduction of the new mechanism.
 *
 * @see https://en.wikipedia.org/wiki/Quantifier_(logic)
 */
export enum PredicateQuantifier {
  /**
   * When choosing 'every' in the config it means that files will only get matched
   * if all the patterns are satisfied by the path of the file, not just at least one of them.
   */
  EVERY = 'every',
  /**
   * When choosing 'some' in the config it means that files will get matched as long as there is
   * at least one pattern that matches them. This is the default behavior if you don't
   * specify anything as a predicate quantifier.
   */
  SOME = 'some',
  /**
   * When choosing 'some-with-excludes' in the config it means that files will get matched if
   * at least one of the patterns matches them and none of the negated patterns (the ones
   * prefixed with '!') matches them. An exclusion is final - a file excluded by one pattern
   * can't be included back by another one.
   *
   * A filter which consists of negated patterns only never matches anything,
   * because there is no pattern which could include a file in the first place.
   */
  SOME_WITH_EXCLUDES = 'some-with-excludes'
}

/**
 * Used to define customizations for how the file filtering should work at runtime.
 */
export type FilterConfig = {readonly predicateQuantifier: PredicateQuantifier}

/**
 * An array of strings (at runtime) that contains the valid/accepted values for
 * the configuration parameter 'predicate-quantifier'.
 */
export const SUPPORTED_PREDICATE_QUANTIFIERS = Object.values(PredicateQuantifier)

export function isPredicateQuantifier(x: unknown): x is PredicateQuantifier {
  return SUPPORTED_PREDICATE_QUANTIFIERS.includes(x as PredicateQuantifier)
}

export interface FilterResults {
  [key: string]: File[]
}

export class Filter {
  rules: {[key: string]: FilterRuleItem[]} = {}

  // Creates instance of Filter and load rules from YAML if it's provided
  constructor(yaml?: string, readonly filterConfig?: FilterConfig) {
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
      this.rules[key] = this.parseFilterItemYaml(item)
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
    const isStatusMatch = (rule: Readonly<FilterRuleItem>): boolean => {
      return rule.status === undefined || rule.status.includes(file.status)
    }
    const aPredicate = (rule: Readonly<FilterRuleItem>): boolean => {
      return isStatusMatch(rule) && rule.isMatch(file.filename)
    }

    switch (this.filterConfig?.predicateQuantifier) {
      case PredicateQuantifier.EVERY:
        return patterns.every(aPredicate)
      case PredicateQuantifier.SOME_WITH_EXCLUDES: {
        let isIncluded = false
        for (const rule of patterns) {
          if (!isStatusMatch(rule)) {
            continue
          }
          // Once a file is excluded it stays excluded - no other pattern can include it back.
          // Therefore all the patterns have to be evaluated even if the file is already included.
          if (rule.isExclude?.(file.filename)) {
            return false
          }
          if (!isIncluded && rule.isInclude?.(file.filename)) {
            isIncluded = true
          }
        }
        return isIncluded
      }
      default:
        return patterns.some(aPredicate)
    }
  }

  private parseFilterItemYaml(item: FilterItemYaml): FilterRuleItem[] {
    if (Array.isArray(item)) {
      return flat(item.map(i => this.parseFilterItemYaml(i)))
    }

    if (typeof item === 'string') {
      return [createRuleItem(item)]
    }

    if (typeof item === 'object') {
      return Object.entries(item).map(([key, pattern]) => {
        if (typeof key !== 'string' || (typeof pattern !== 'string' && !Array.isArray(pattern))) {
          this.throwInvalidFormatError(
            `Expected [key:string]= pattern:string | string[], but [${key}:${typeof key}]= ${pattern}:${typeof pattern} found`
          )
        }
        const status = key
          .split('|')
          .map(x => x.trim())
          .filter(x => x.length > 0)
          .map(x => x.toLowerCase()) as ChangeStatus[]
        return createRuleItem(pattern, status)
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

// Compiles filename pattern(s) of a single filter rule item into matchers.
// Multiple patterns are OR-ed together, which is how picomatch treats an array of globs.
// Patterns are also split by their polarity, so PredicateQuantifier.SOME_WITH_EXCLUDES
// can tell inclusions from exclusions. Note that only a leading '!' negates the whole
// pattern - the '!(...)' extglob is a regular pattern matching everything it doesn't enumerate.
function createRuleItem(patterns: string | string[], status?: ChangeStatus[]): FilterRuleItem {
  const matchers = (Array.isArray(patterns) ? patterns : [patterns]).map(pattern =>
    picomatch(pattern, MatchOptions, true)
  )
  // picomatch inverts the result of a matcher created from a negated pattern.
  // Inverting it back gives a matcher of the filenames such pattern excludes.
  const includes = matchers.filter(matcher => !matcher.state.negated)
  const excludes = matchers.filter(matcher => matcher.state.negated)

  return {
    status,
    isMatch: str => matchers.some(matcher => matcher(str)),
    isInclude: includes.length > 0 ? str => includes.some(matcher => matcher(str)) : undefined,
    isExclude: excludes.length > 0 ? str => excludes.some(matcher => !matcher(str)) : undefined
  }
}
