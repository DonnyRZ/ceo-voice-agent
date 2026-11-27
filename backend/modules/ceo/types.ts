import type { WorkStatus } from '../work-status.js';

export type StatusCounts = Record<WorkStatus, number>;

export type CeoDivision = {
  id: string;
  name: string;
  code: string;
  description: string;
  status: 'active' | 'archived';
  updatedAt: Date;
  memberCount: number;
  projectCount: number;
  taskCount: number;
  byStatus: StatusCounts;
  progress: number;
};

export type CeoProject = {
  id: string;
  name: string;
  description: string;
  status: WorkStatus;
  version: number;
  updatedAt: Date;
  divisionId: string;
  divisionName: string;
  taskCount: number;
  byStatus: StatusCounts;
  progress: number;
  picNames: string[];
};
