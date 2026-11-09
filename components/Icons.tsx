/** Small line icons, drawn in-house. */
const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, viewBox: "0 0 16 16" };

export const UndoIcon = () => (
  <svg {...base}>
    <path d="M5.5 4 2.5 7l3 3" />
    <path d="M2.8 7h6.7a4 4 0 0 1 0 8H7" />
  </svg>
);
export const RedoIcon = () => (
  <svg {...base}>
    <path d="m10.5 4 3 3-3 3" />
    <path d="M13.2 7H6.5a4 4 0 0 0 0 8H9" />
  </svg>
);
export const HistoryIcon = () => (
  <svg {...base}>
    <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
    <path d="M2.5 2.5v2.6h2.6" />
    <path d="M8 5v3.2l2 1.3" />
  </svg>
);
export const ComposeIcon = () => (
  <svg {...base}>
    <rect x="2" y="2.5" width="4.5" height="11" rx="1.2" />
    <path d="M9 4h5M9 8h5M9 12h3" />
  </svg>
);
export const SystemIcon = () => (
  <svg {...base}>
    <rect x="9.5" y="2.5" width="4.5" height="11" rx="1.2" />
    <path d="M2 4h5M2 8h5M2 12h3" />
  </svg>
);
export const LibraryIcon = () => (
  <svg {...base}>
    <path d="M3 2.5v11M6 2.5v11" />
    <path d="m9 3 3.5 10" />
  </svg>
);
export const ImmersiveIcon = () => (
  <svg {...base}>
    <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
  </svg>
);
