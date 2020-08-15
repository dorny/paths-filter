// Credits to https://github.com/xxorax/node-shell-escape

export default function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
    .replace(/^(?:'')+/g, '') // unduplicate single-quote at the beginning
    .replace(/\\'''/g, "\\'") // remove non-escaped single-quote if there are enclosed between 2 escaped
}
