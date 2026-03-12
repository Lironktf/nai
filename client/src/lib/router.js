import { useEffect, useMemo, useState } from 'react';

function parseHashRoute() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [pathnamePart, searchPart = ''] = raw.split('?');
  const pathname = pathnamePart.startsWith('/') ? pathnamePart : `/${pathnamePart}`;
  const params = Object.fromEntries(new URLSearchParams(searchPart));
  return { pathname, params };
}

export function buildHash(pathname, params = {}) {
  const search = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value != null && value !== '')
  ).toString();
  return `#${pathname}${search ? `?${search}` : ''}`;
}

export function navigate(pathname, params = {}, { replace = false } = {}) {
  const next = buildHash(pathname, params);
  if (replace) {
    window.history.replaceState(null, '', next);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  window.location.hash = next;
}

export function useHashRoute() {
  const [route, setRoute] = useState(() => parseHashRoute());

  useEffect(() => {
    const onChange = () => setRoute(parseHashRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return useMemo(() => ({
    ...route,
    navigate: (pathname, params, options) => navigate(pathname, params, options),
  }), [route]);
}
