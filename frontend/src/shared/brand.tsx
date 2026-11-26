import { Link } from 'react-router-dom';
import logoUrl from '../../../logo/ruang-kerja-logo.png';

export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link className="brand" to={to}>
      <img src={logoUrl} alt="Ruang Kerja" />
    </Link>
  );
}
