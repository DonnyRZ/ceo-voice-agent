import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { CalendarDays, ClipboardCheck, Layers3, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Task } from '../../shared/types'
import { shortTaskDate } from './task-dates'
import { IconTile, StatusBadge } from './timesheet-ui'

const column = createColumnHelper<Task>()
const columns = [
  column.accessor('date', {
    header: 'Tanggal',
    cell: ({ getValue }) => <span className="ts-table-date"><CalendarDays aria-hidden="true" />{shortTaskDate(getValue())}</span>,
  }),
  column.accessor('title', {
    header: 'Tugas',
    cell: ({ row, getValue }) => <Link className="ts-task-link" to={`/timesheet/${row.original.id}`}>{getValue()}</Link>,
  }),
  column.accessor('description', { header: 'Deskripsi', cell: ({ getValue }) => getValue() || '—' }),
  column.accessor('projectName', {
    header: 'Proyek',
    cell: ({ getValue }) => <span className="ts-table-meta"><IconTile icon={Layers3} /><strong>{getValue()}</strong></span>,
  }),
  column.accessor('picName', {
    header: 'PIC',
    cell: ({ getValue }) => <span className="ts-table-meta"><IconTile icon={UserRound} />{getValue()}</span>,
  }),
  column.accessor('status', {
    header: 'Status',
    cell: ({ getValue }) => <StatusBadge status={getValue()} showIcon />,
  }),
]

export function TaskListResults({ tasks, empty }: { tasks: Task[]; empty?: ReactNode }) {
  const table = useReactTable({ data: tasks, columns, getCoreRowModel: getCoreRowModel() })
  return (
    <>
      <div className="ts-card ts-table-frame">
        <table className="ts-table" aria-label="Daftar tugas">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th key={header.id} scope="col">{flexRender(header.column.columnDef.header, header.getContext())}</th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!tasks.length && empty}
      </div>
      <div className="ts-mobile-tasks" aria-label="Daftar tugas">
        {tasks.map((task) => <MobileTask key={task.id} task={task} />)}
        {!tasks.length && empty}
      </div>
    </>
  )
}

function MobileTask({ task }: { task: Task }) {
  const [day, month] = shortTaskDate(task.date).split(' ')
  return (
    <article className="ts-card ts-mobile-task">
      <time className="ts-date-stamp" dateTime={task.date}><strong>{day}</strong>{month}</time>
      <div className="ts-mobile-task-content">
        <Link to={`/timesheet/${task.id}`} className="ts-task-link">
          <ClipboardCheck size={18} aria-hidden="true" /> <strong>{task.title}</strong>
        </Link>
        <p className="ts-mobile-task-description"><strong>Deskripsi:</strong> {task.description || '—'}</p>
        <p><Layers3 size={18} aria-hidden="true" /> {task.projectName}</p>
        <p><UserRound size={18} aria-hidden="true" /> {task.picName}</p>
        <StatusBadge status={task.status} />
      </div>
    </article>
  )
}
