export type Status = 'pending' | 'on_progress' | 'done';

interface SessionIdentity {
  id: string;
  name: string;
  email: string;
}

export interface MemberSessionUser extends SessionIdentity {
  role: 'member';
  divisionId: string;
  divisionName: string;
}

export interface SuperadminSessionUser extends SessionIdentity {
  role: 'superadmin';
  divisionId: null;
  divisionName: null;
}

export interface CeoSessionUser extends SessionIdentity {
  role: 'ceo';
  divisionId: null;
  divisionName: null;
}

export type SessionUser = MemberSessionUser | SuperadminSessionUser | CeoSessionUser;

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
