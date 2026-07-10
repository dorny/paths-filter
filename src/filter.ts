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
  SOME = 'some'
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
    const aPredicate = (rule: Readonly<FilterRuleItem>): boolean => {
      return (rule.status === undefined || rule.status.includes(file.status)) && rule.isMatch(file.filename)
    }
    if (this.filterConfig?.predicateQuantifier === 'every') {
      return patterns.every(aPredicate)
    } else {
      return patterns.some(aPredicate)
    }
  }

  private parseFilterItemYaml(item: FilterItemYaml): FilterRuleItem[] {
    if (Array.isArray(item)) {
      // Under the default 'some' quantifier, group all (recursively flattened)
      // bare string patterns into a single matcher with gitignore-style
      // semantics: a file matches the rule when it matches at least one
      // positive pattern AND does not match any negation pattern.
      //
      // Without this grouping, each '!pattern' is compiled into its own
      // picomatch matcher that returns true for every file *not* matching the
      // pattern. The default 'some' quantifier then OR's those predicates
      // together, so a standalone '!**/*.md' makes the whole rule match
      // nearly any path. The 'every' quantifier already produces correct
      // subtractive semantics under per-pattern matching, so it keeps the
      // legacy parsing path unchanged.
      if (this.filterConfig?.predicateQuantifier !== PredicateQuantifier.EVERY) {
        const {stringPatterns, otherItems} = this.collectArrayItems(item)
        const grouped = this.groupedStringMatcher(stringPatterns)
        if (grouped === undefined && otherItems.length === 0) {
          this.throwInvalidFormatError(
            'Filter rule must contain at least one positive pattern; got only negation patterns or an empty pattern list'
          )
        }
        const result: FilterRuleItem[] = []
        if (grouped !== undefined) {
          result.push({status: undefined, isMatch: grouped})
        }
        result.push(...otherItems)
        return result
      }
      return flat(item.map(i => this.parseFilterItemYaml(i)))
    }

    if (typeof item === 'string') {
      return [{status: undefined, isMatch: picomatch(item, MatchOptions)}]
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
        return {status, isMatch: this.compileStatusPattern(pattern, key)}
      })
    }

    this.throwInvalidFormatError(`Unexpected element type '${typeof item}'`)
  }

  // Recursively walk a YAML array (which may contain nested arrays from YAML
  // anchors) and partition its leaves into raw string patterns vs. fully
  // parsed FilterRuleItems for status-tagged objects.
  private collectArrayItems(item: FilterItemYaml): {stringPatterns: string[]; otherItems: FilterRuleItem[]} {
    if (Array.isArray(item)) {
      const stringPatterns: string[] = []
      const otherItems: FilterRuleItem[] = []
      for (const i of item) {
        const sub = this.collectArrayItems(i)
        stringPatterns.push(...sub.stringPatterns)
        otherItems.push(...sub.otherItems)
      }
      return {stringPatterns, otherItems}
    }
    if (typeof item === 'string') {
      return {stringPatterns: [item], otherItems: []}
    }
    return {stringPatterns: [], otherItems: this.parseFilterItemYaml(item)}
  }

  // Compiles the right-hand side of a status-tagged YAML entry (e.g.
  // `added: 'src/**'` or `added: ['src/**', '!src/**/*.md']`) into a single
  // matcher. String-array forms are routed through groupedStringMatcher so
  // they get the same gitignore-style negation semantics as bare-array rules
  // - otherwise the same #260 bug shape would still bite under a status tag.
  // A single string pattern keeps the legacy single-picomatch compilation,
  // which preserves existing behavior for `!(extglob)` and plain literals.
  private compileStatusPattern(pattern: string | string[], key: string): (str: string) => boolean {
    if (typeof pattern === 'string') {
      return picomatch(pattern, MatchOptions)
    }
    const matcher = this.groupedStringMatcher(pattern)
    if (matcher === undefined) {
      this.throwInvalidFormatError(
        `Status-tagged filter '${key}' must contain at least one positive pattern; got only negation patterns or an empty list`
      )
    }
    return matcher
  }

  // Builds a single matcher with gitignore-style semantics over a list of
  // string patterns: a file matches when at least one positive pattern matches
  // and no negation pattern matches.
  //
  // A pattern is treated as a gitignore-style negation only when it begins
  // with '!' followed by anything other than '('. The '!(...)' form is an
  // extglob expression that picomatch parses as a single pattern, so it must
  // not be split into a positive/negative pair.
  //
  // Returns undefined when the list contains no positive patterns - in that
  // case there is nothing to include, so the rule cannot match any file.
  private groupedStringMatcher(patterns: string[]): ((str: string) => boolean) | undefined {
    const positives: string[] = []
    const negatives: string[] = []
    for (const p of patterns) {
      if (this.isNegationPrefix(p)) {
        negatives.push(p.slice(1))
      } else {
        positives.push(p)
      }
    }
    if (positives.length === 0) {
      return undefined
    }
    const positiveMatcher = picomatch(positives, MatchOptions)
    if (negatives.length === 0) {
      return positiveMatcher
    }
    const negativeMatcher = picomatch(negatives, MatchOptions)
    return (str: string) => positiveMatcher(str) && !negativeMatcher(str)
  }

  private isNegationPrefix(pattern: string): boolean {
    return pattern.length > 1 && pattern.startsWith('!') && !pattern.startsWith('!(')
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
