import type { ReactNode } from 'react';

export function AdminEmptyState({ title, description, image = 'empty', action }: {
  title: string;
  description?: string;
  image?: 'empty' | 'no-results';
  action?: ReactNode;
}) {
  return (
    <div className="admin-empty" role="status">
      <img src={`/images/admin-${image}.png`} alt="" />
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
