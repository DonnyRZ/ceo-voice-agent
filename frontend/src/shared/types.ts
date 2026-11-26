export type Status = 'pending' | 'on_progress' | 'done';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  divisionId: string;
  divisionName: string;
}

export interface Member {
  id: string;
  name: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: Status;
  version: number;
  updatedAt: string;
}

export interface Task {
  id: string;
  date: string;
  title: string;
  description: string;
  projectId: string;
  projectName: string;
  picId: string;
  picName: string;
  status: Status;
  version: number;
  updatedAt: string;
}
