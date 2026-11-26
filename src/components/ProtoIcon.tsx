import type { ReactNode } from 'react';

export type ProtoIconName =
  | 'brand'
  | 'info'
  | 'alert'
  | 'ok'
  | 'pause'
  | 'block'
  | 'chev'
  | 'down'
  | 'copy'
  | 'sync'
  | 'plus'
  | 'search'
  | 'arrow'
  | 'home'
  | 'server'
  | 'puzzle'
  | 'book'
  | 'terminal'
  | 'trash'
  | 'key'
  | 'download'
  | 'inbox'
  | 'dot';

const ICON_PATHS: Record<Exclude<ProtoIconName, 'dot'>, ReactNode> = {
  brand: (
    <>
      <rect x="8" y="8" width="8" height="8" rx="1.5" />
      <path d="M12 2v6M12 16v6M2 12h6M16 12h6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2.5 20h19L12 3z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  ok: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </>
  ),
  pause: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 9v6M14 9v6" />
    </>
  ),
  block: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m6 6 12 12" />
    </>
  ),
  chev: <path d="m9 6 6 6-6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </>
  ),
  sync: (
    <>
      <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 13a8 8 0 0 0 14.3 4.9L20 16" />
      <path d="M4 3v5h5M20 21v-5h-5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  home: (
    <>
      <path d="M3 11 12 4l9 7" />
      <path d="M5 10v10h14V10" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </>
  ),
  puzzle: (
    <path d="M10 3h4v3a2 2 0 1 0 4 0h0V3h3v6h-3a2 2 0 1 0 0 4h3v8h-7v-3a2 2 0 1 0-4 0v3H3v-8h3a2 2 0 1 0 0-4H3V3h7z" />
  ),
  book: (
    <>
      <path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z" />
      <path d="M20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3M13 15h4" />
    </>
  ),
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9M17 6l3 3" />
    </>
  ),
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  inbox: (
    <>
      <path d="M3 13h5l2 3h4l2-3h5" />
      <path d="M5 5h14l2 8v6H3v-6z" />
    </>
  ),
};

export function ProtoIcon({ name, className = '' }: { name: ProtoIconName; className?: string }) {
  if (name === 'dot') {
    return (
      <svg className={`od-icon ${className}`.trim()} viewBox="0 0 10 10" aria-hidden="true">
        <circle cx="5" cy="5" r="5" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg
      className={`od-icon ${className}`.trim()}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}
