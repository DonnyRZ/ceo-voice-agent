import { ArrowLeft, Laptop, Layers, Smartphone } from 'lucide-react';
import { Link } from 'react-router-dom';
import './projects.css';

type HeadingProps = {
  title: string;
  section: string;
  context: string;
  parentPath?: string;
};

export function ProjectHeading({ title, section, context, parentPath }: HeadingProps) {
  return (
    <header className="project-heading">
      {parentPath && (
        <Link className="project-mobile-back" to={parentPath}>
          <ArrowLeft aria-hidden="true" size={20} />
          {section}
        </Link>
      )}
      <h1>{title}</h1>
      <div className="project-breadcrumb">
        {parentPath ? <Link to={parentPath}>{section}</Link> : <span>{section}</span>}
        <span aria-hidden="true">/</span>
        <strong>{context}</strong>
      </div>
    </header>
  );
}

export function ProjectIcon({ name, forceLayers = false }: { name: string; forceLayers?: boolean }) {
  const Icon = !forceLayers && name.toLocaleLowerCase('id-ID').includes('mobile') ? Smartphone : Layers;

  return (
    <span className="project-icon" aria-hidden="true">
      <Icon size={26} strokeWidth={1.65} />
    </span>
  );
}

export function DivisionBanner({ name, readOnly = false }: { name: string; readOnly?: boolean }) {
  return (
    <div className={`project-division${readOnly ? ' project-division-readonly' : ''}`}>
      <span className="project-icon" aria-hidden="true"><Laptop size={29} strokeWidth={1.65} /></span>
      <strong>{name}</strong>
      {readOnly && <small>Hanya Baca</small>}
    </div>
  );
}

export function ProjectError({ retry, children }: { retry?: () => void; children: string }) {
  return (
    <div className="project-error" role="alert">
      <span>{children}</span>
      {retry && <button type="button" className="project-button project-button-outline" onClick={retry}>Coba lagi</button>}
    </div>
  );
}
