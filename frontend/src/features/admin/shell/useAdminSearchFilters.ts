import { useLayoutEffect, useRef } from 'react';
import { useNavigationType, useSearchParams } from 'react-router-dom';

export function useAdminSearchFilters() {
  const [params, setParams] = useSearchParams();
  const navigationType = useNavigationType();
  const pending = useRef<URLSearchParams | null>(null);

  useLayoutEffect(() => {
    if (navigationType === 'POP' || pending.current?.toString() === params.toString()) {
      pending.current = null;
    }
  }, [navigationType, params]);

  function replaceFilters(change: URLSearchParams | ((next: URLSearchParams) => void)) {
    const next = change instanceof URLSearchParams ? change : new URLSearchParams(pending.current ?? params);
    if (typeof change === 'function') change(next);
    pending.current = next;
    setParams(next, { replace: true, flushSync: true });
  }

  return [params, replaceFilters] as const;
}
