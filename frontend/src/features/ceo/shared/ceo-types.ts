import type { Member, Project, Status, Task } from '../../../shared/types';

export type StatusCounts = Record<Status, number>;

export interface CeoTask extends Task {
  divisionId: string;
  divisionName: string;
}

export interface CeoDivision {
  id: string;
  name: string;
  code: string;
  description: string;
  status: 'active' | 'archived';
  updatedAt: string;
  memberCount: number;
  projectCount: number;
  taskCount: number;
  byStatus: StatusCounts;
  progress: number;
}

export interface CeoProject extends Project {
  divisionId: string;
  divisionName: string;
  taskCount: number;
  byStatus: StatusCounts;
  progress: number;
  picNames: string[];
}

export interface CeoDashboard {
  counts: { divisions: number; projects: number; tasks: number; members: number };
  byStatus: StatusCounts;
  divisions: CeoDivision[];
  recentTasks: CeoTask[];
  updatedAt: string | null;
}

export interface CeoDivisionDetail extends CeoDivision {
  members: Member[];
  projects: CeoProject[];
  tasks: CeoTask[];
}

export interface CeoProjectDetail extends CeoProject {
  tasks: CeoTask[];
}

export interface CeoTaskHistory {
  id: string;
  changedAt: string;
  previousStatus: Status | null;
  status: Status;
  actorName: string | null;
}
