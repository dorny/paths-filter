export interface FileStatus {
  filename: string
  status: ChangeStatus
}

export interface FileNumstat {
  filename: string
  additions: number
  deletions: number
}

export type File = FileStatus & FileNumstat

export enum ChangeStatus {
  Added = 'added',
  Copied = 'copied',
  Deleted = 'deleted',
  Modified = 'modified',
  Renamed = 'renamed',
  Unmerged = 'unmerged'
}
