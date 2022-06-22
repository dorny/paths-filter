import {exec as execImpl, ExecOptions} from '@actions/exec'

// Wraps original exec() function
// Returns exit code and whole stdout/stderr
export default async function exec(commandLine: string, args?: string[], options?: ExecOptions): Promise<ExecResult> {
  options = options || {}
  let stdout = []
  let stderr = []
  options.listeners = {
    stdout: (data: Buffer) => stdout.push(data),
    stderr: (data: Buffer) => stderr.push(data),
  }
  const code = await execImpl(commandLine, args, options)
  return {code, Buffer.concat(stdout).toString(), Buffer.concat(stderr).toString()}
}

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}
