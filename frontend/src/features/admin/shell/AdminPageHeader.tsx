import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Breadcrumb = { label: string; to?: string };

export function AdminPageHeader({ title, breadcrumbs = [], action, mobileContext }: {
  title: string;
  breadcrumbs?: Breadcrumb[];
  action?: ReactNode;
  mobileContext?: string;
}) {
  const back = breadcrumbs.filter((crumb) => crumb.to).at(-1);
  return (
    <header className="admin-page-heading">
      {mobileContext
        ? <p className="admin-context">{mobileContext}</p>
        : back?.to && <Link className="admin-back" to={back.to}><ArrowLeft aria-hidden="true" />{back.label}</Link>}
      <div className="admin-title-row">
        <h1 className="page-title">{title}</h1>
        {action}
      </div>
      {breadcrumbs.length > 0 && (
        <nav className="admin-crumbs" aria-label="Jejak navigasi">
          {breadcrumbs.map(({ label, to }, index) => (
            <span key={label}>
              {index > 0 && <span aria-hidden="true">/</span>}
              {to ? <Link to={to}>{label}</Link> : <strong>{label}</strong>}
            </span>
          ))}
        </nav>
      )}
    </header>
  );
}
