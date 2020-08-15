// Credits to https://github.com/xxorax/node-shell-escape

const needEscape = /[^A-Za-z0-9_/:=-]/

export default function shellEscape(value: string): string {
  if (needEscape.test(value)) {
    value = `'${value.replace(/'/g, "'\\''")}'`
    value = value
      .replace(/^(?:'')+/g, '') // unduplicate single-quote at the beginning
      .replace(/\\'''/g, "\\'") // remove non-escaped single-quote if there are enclosed between 2 escaped
  }

  return value
}
