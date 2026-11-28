import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Calendar, ClipboardCheck, Layers, UserRound } from 'lucide-react';
import { useLocation, useParams } from 'react-router-dom';
import { LoadProblem, StatusBadge } from '../../../shared/ui';
import { AdminBanner, AdminTile } from '../shell/AdminElements';
import { AdminPageHeader } from '../shell/AdminPageHeader';
import { adminAuditDetailQuery, auditActor, auditDateTime, auditDescription, auditSubject, workStatus } from './audit-data';
import { AuditComparison } from './AuditComparison';
import './admin-audit.css';

export function AdminAuditDetailPage() {
  const { id = '' } = useParams();
  const { state } = useLocation();
  const backQuery: unknown = state?.backQuery;
  const back = `/admin/audit${typeof backQuery === 'string' && backQuery ? `?${backQuery}` : ''}`;
  const details = useQuery(adminAuditDetailQuery(id));
  const event = details.data;
  const subject = event && auditSubject(event);

  return (
    <div className="admin-page admin-audit-detail">
      <AdminPageHeader title="Detail Perubahan Audit" breadcrumbs={[
        { label: 'Audit Log', to: back }, { label: 'Detail Perubahan Audit' },
      ]} />
      {details.isPending ? <p role="status"><span className="loading-inline"><span className="ui-spinner" aria-hidden="true" />Memuat detail perubahan</span></p>
        : details.isError ? <LoadProblem title="Perubahan belum dapat dimuat." retry={() => void details.refetch()} />
        : event && <>
          <AdminBanner icon={ClipboardCheck} title={auditDescription(event)} description={<span className="audit-desktop-subject">{subject}</span>} />
          <section className="admin-surface" aria-label="Informasi perubahan">
            <dl className="audit-detail-fields">
              <div className="audit-mobile-subject"><AdminTile icon={Layers} /><dt>Data</dt><dd>{subject}</dd></div>
              <div><AdminTile icon={UserRound} /><dt>Pengguna</dt><dd>{auditActor(event)}</dd></div>
              <div><AdminTile icon={Layers} /><dt>Divisi</dt><dd>{event.divisionName ?? '—'}</dd></div>
              <div><AdminTile icon={Calendar} /><dt>Waktu Perubahan</dt>
                <dd><time dateTime={event.changedAt}>{auditDateTime(event.changedAt)}</time></dd></div>
            </dl>
          </section>
          <section className="admin-surface audit-comparison" aria-labelledby="audit-comparison-title">
            <h2 id="audit-comparison-title">Perbandingan Perubahan</h2>
            {event.entity === 'task' && workStatus(event.before?.status) && workStatus(event.after?.status)
              && event.before.status !== event.after.status ? (
              <div className="audit-comparison-grid">
                <div className={`audit-diff audit-diff-${event.before.status}`}><h3>Sebelum</h3><StatusBadge status={event.before.status} icon /></div>
                <ArrowRight className="audit-diff-arrow" aria-hidden="true" />
                <div className={`audit-diff audit-diff-${event.after.status}`}><h3>Sesudah</h3><StatusBadge status={event.after.status} icon /></div>
              </div>
            ) : <AuditComparison before={event.before} after={event.after} />}
          </section>
        </>}
    </div>
  );
}
