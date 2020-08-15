import shellEscape from '../src/shell-escape'

test('simple path escaped', () => {
  expect(shellEscape('file')).toBe("'file'")
})

test('path with space is wrapped with single quotes', () => {
  expect(shellEscape('file with space')).toBe("'file with space'")
})

test('path with quote is divided into quoted segments and escaped quote', () => {
  expect(shellEscape("file'with quote")).toBe("'file'\\''with quote'")
})
test('path with leading quote does not have double quotes at beginning', () => {
  expect(shellEscape("'file-leading-quote")).toBe("\\''file-leading-quote'")
})
