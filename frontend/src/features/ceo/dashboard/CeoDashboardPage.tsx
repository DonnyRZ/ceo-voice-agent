import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Mic } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { currentMonth } from '../../timesheets/task-dates';
import { CeoEmpty, CeoPageHeader, CeoPeriodPicker, CeoQueryProblem, CeoStatusSummary, CeoUpdatedAt } from '../shared/CeoElements';
import { CeoTaskList } from '../shared/CeoTaskList';
import { ceoDashboardQuery, validMonth } from '../shared/ceo-data';
import './ceo-dashboard.css';

export function CeoDashboardPage() {
  const [params, setParams] = useSearchParams();
  const month = validMonth(params.get('month')) || currentMonth();
  const dashboard = useQuery(ceoDashboardQuery(month));
  const data = dashboard.data;

  return <div className="ceo-page ceo-dashboard-page">
    <CeoPageHeader title="Dashboard CEO" />
    <CeoPeriodPicker month={month} onChange={(value) => value && setParams({ month: value })} />
    {dashboard.isPending ? <CeoEmpty><span className="loading-inline"><span className="ui-spinner" aria-hidden="true" />Memuat ringkasan pekerjaan</span></CeoEmpty>
      : dashboard.isError ? <CeoQueryProblem error={dashboard.error} name="Ringkasan pekerjaan" retry={() => void dashboard.refetch()} />
        : data && <>
          <CeoStatusSummary counts={data.byStatus} heading="Ringkasan pekerjaan">
            <Link className="ui-button ceo-dashboard-voice" to="/ceo/voice"><Mic aria-hidden="true" />Buka Voice Agent</Link>
          </CeoStatusSummary>
          <section className="ceo-surface ceo-section ceo-dashboard-updates" aria-labelledby="ceo-updates-heading">
            <div className="ceo-section-title">
              <h2 id="ceo-updates-heading">Pembaruan terbaru</h2>
              <Link className="ceo-inline-link" to={`/ceo/divisions?${new URLSearchParams({ month, status: 'all' })}`}>Lihat semua divisi <ArrowRight aria-hidden="true" /></Link>
            </div>
            <CeoTaskList tasks={data.recentTasks} month={month} showDivision />
          </section>
          <p className="ceo-data-note">Ringkasan berdasarkan tanggal tugas pada periode terpilih. Pembaruan data terakhir: <CeoUpdatedAt value={data.updatedAt} />.</p>
        </>}
  </div>;
}
