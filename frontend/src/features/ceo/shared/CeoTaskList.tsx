import { ChevronRight, ClipboardCheck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { StatusBadge } from '../../../shared/ui';
import { CeoEmpty, CeoTile, CeoUpdatedAt } from './CeoElements';
import { withPeriod } from './ceo-data';
import type { CeoTask } from './ceo-types';
import { withVoiceSource } from './CeoVoiceSourceNote';

export function CeoTaskList({ tasks, month = '', showDivision = false, descriptions = false }: {
  tasks: CeoTask[]; month?: string; showDivision?: boolean; descriptions?: boolean;
}) {
  const [params] = useSearchParams();
  if (!tasks.length) return <CeoEmpty>Belum ada tugas tercatat untuk periode ini.</CeoEmpty>;
  return <ul className="ceo-list ceo-task-list">
    {tasks.map((task) => <li key={task.id}>
      <Link className="ceo-record-link" aria-label={task.title} to={withVoiceSource(withPeriod(`/ceo/tasks/${task.id}`, month), params)}>
        <CeoTile icon={ClipboardCheck} />
        <div className="ceo-record-copy">
          <strong>{task.title}</strong>
          <StatusBadge status={task.status} />
          <p>{showDivision && `${task.divisionName} · `}{task.projectName}</p>
          {descriptions && task.description && <p>{task.description}</p>}
          <p>Diperbarui <CeoUpdatedAt value={task.updatedAt} /></p>
        </div>
        <ChevronRight aria-hidden="true" />
      </Link>
    </li>)}
  </ul>;
}
