import { Calendar, Layers, Tag, UserRound } from 'lucide-react';
import type { AdminDivision } from '../divisions/division-data';
import { monthName, recentMonths } from '../../timesheets/task-dates';
import { statusLabels } from '../../../shared/ui';
import { AdminFilter, statuses, type FilterOption } from '../shell/AdminElements';
import type { AdminTask } from './report-data';

export function namedOptions(items: FilterOption[]) {
  return [...new Map(items.map((item) => [item.value, item])).values()]
    .sort((left, right) => left.label.localeCompare(right.label, 'id'));
}

export function ReportFilters({ divisions, tasks, params, set }: {
  divisions: AdminDivision[];
  tasks: AdminTask[];
  params: URLSearchParams;
  set: (name: string, value: string) => void;
}) {
  const division = params.get('divisionId') ?? '';
  const matching = division ? tasks.filter((task) => task.divisionId === division) : tasks;
  const projects = namedOptions(matching.map(({ projectId, projectName }) => ({ value: projectId, label: projectName })));
  const members = namedOptions(matching.map(({ picId, picName }) => ({ value: picId, label: picName })));
  const months = recentMonths(tasks.map(({ date }) => date.slice(0, 7)));

  return (
    <div className="admin-filters admin-filters-mint admin-report-filters">
      <AdminFilter icon={Layers} label="Divisi" empty="Semua Divisi" value={division} onChange={(value) => set('divisionId', value)}
        options={divisions.map(({ id, name }) => ({ value: id, label: name }))} />
      <AdminFilter icon={Calendar} label="Periode" empty="Semua Periode" value={params.get('period') ?? ''} onChange={(value) => set('period', value)}
        options={months.map((value) => ({ value, label: monthName(value) }))} />
      <AdminFilter icon={Layers} label="Proyek" empty="Semua Proyek" value={params.get('projectId') ?? ''} onChange={(value) => set('projectId', value)} options={projects} />
      <AdminFilter icon={UserRound} label="PIC" empty="Semua PIC" value={params.get('picId') ?? ''} onChange={(value) => set('picId', value)} options={members} />
      <AdminFilter icon={Tag} label="Status" empty="Semua Status" value={params.get('status') ?? ''} onChange={(value) => set('status', value)}
        options={statuses.map((value) => ({ value, label: statusLabels[value] }))} />
    </div>
  );
}
