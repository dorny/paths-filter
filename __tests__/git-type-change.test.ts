import {execFileSync} from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {getChanges} from '../src/git'
import {Filter} from '../src/filter'

test('same-path Git type changes remain visible to change-type filters in both directions', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'paths-filter-type-change-'))
  const previousDirectory = process.cwd()
  const previousGlobal = process.env.GIT_CONFIG_GLOBAL
  const previousSystem = process.env.GIT_CONFIG_NOSYSTEM
  const filename = 'kind change.txt'
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: path.join(directory, 'fixture.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Local test fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Local test fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid'
  }
  const git = (args: string[], input?: string): string =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd: directory,
      env,
      input,
      encoding: 'utf8'
    }).trim()

  try {
    git(['init', '--quiet'])
    fs.writeFileSync(path.join(directory, filename), 'regular file')
    git(['add', '--', filename])
    git(['commit', '--quiet', '-m', 'regular fixture'])
    const regular = git(['rev-parse', 'HEAD'])
    const regularBlob = git(['rev-parse', `HEAD:${filename}`])
    const linkBlob = git(['hash-object', '-w', '--stdin'], 'link-target')
    // Build a real symlink-mode Git tree without requiring OS symlink privileges.
    git(['update-index', '--cacheinfo', `120000,${linkBlob},${filename}`])
    git(['commit', '--quiet', '-m', 'symlink fixture'])
    const symlink = git(['rev-parse', 'HEAD'])
    git(['update-index', '--cacheinfo', `100644,${regularBlob},${filename}`])
    git(['commit', '--quiet', '-m', 'regular fixture again'])
    const restored = git(['rev-parse', 'HEAD'])

    process.chdir(directory)
    process.env.GIT_CONFIG_GLOBAL = env.GIT_CONFIG_GLOBAL
    process.env.GIT_CONFIG_NOSYSTEM = '1'
    const filter = new Filter(`typed:\n  - added|modified|deleted: '${filename}'\nplain:\n  - '${filename}'`)
    for (const [base, head] of [
      [regular, symlink],
      [symlink, restored]
    ]) {
      const files = await getChanges(base, head)
      const matches = filter.match(files)
      expect(matches.typed).toEqual(matches.plain)
      expect(matches.typed.map(file => file.filename)).toEqual([filename])
    }
  } finally {
    process.chdir(previousDirectory)
    if (previousGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL
    else process.env.GIT_CONFIG_GLOBAL = previousGlobal
    if (previousSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM
    else process.env.GIT_CONFIG_NOSYSTEM = previousSystem
    fs.rmSync(directory, {recursive: true, force: true})
  }
})
