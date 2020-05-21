// This script replaces absolute path embeded into dist/index.js by ncc compiler
// It's ugly but looks like there's no other easy way how to get rid of it
// Main monitavion is to be able to have autoamted check whether checked-in index.js file matches
// output of fresh build. Without this fix there is always diff.

const fs = require('fs')
const distIndexPath = 'dist/index.js'
const content = fs.readFileSync(distIndexPath, 'utf8')
const absPath = process.cwd()
const fixedPath = './node_modules/@actions/github'

const windowsPath = `${absPath.replace(/\\/g, '\\\\')}\\\\node_modules\\\\@actions\\\\github`;
const linuxPath = `${absPath}/node_modules/@actions/github`

const fixedContent = content
  .replace(windowsPath, fixedPath)
  .replace(linuxPath, fixedPath)
  .replace(/\r\n/g, '\n')

fs.writeFileSync(distIndexPath, fixedContent)