// Uses easy safe set of characters which can be left unescaped to keep it readable.
// Every other character will be backslash-escaped
export default function shellEscape(value: string): string {
  return value.replace(/([^a-zA-Z0-9,._+:@%/-])/gm, '\\$1')
}
