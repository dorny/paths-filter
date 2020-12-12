import shellEscape from '../src/shell-escape'

test('simple filename should not be modified', () => {
  expect(shellEscape('file.txt')).toBe('file.txt')
})

test('directory separator should be preserved and not escaped', () => {
  expect(shellEscape('path/to/file.txt')).toBe('path/to/file.txt')
})

test('spaces should be escaped with backslash', () => {
  expect(shellEscape('file with space')).toBe('file\\ with\\ space')
})

test('quotes should be escaped  with backslash', () => {
  expect(shellEscape('file\'with quote"')).toBe('file\\\'with\\ quote\\"')
})

test('$variables sould be escaped', () => {
  expect(shellEscape('$var')).toBe('\\$var')
})
