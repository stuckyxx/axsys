import React from 'react';

type IconProps = {
  className?: string;
};

const baseProps = {
  fill: 'none',
  viewBox: '0 0 24 24',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const createIcon =
  (path: React.ReactNode) =>
  ({ className = 'h-5 w-5' }: IconProps) =>
    (
      <svg className={className} {...baseProps}>
        {path}
      </svg>
    );

export const BellIcon = createIcon(
  <>
    <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5" />
    <path d="M10 17a2 2 0 0 0 4 0" />
  </>,
);

export const SettingsIcon = createIcon(
  <>
    <path d="M12 3.5l1 .3a2 2 0 0 1 1.3 1.2l.3.8a2 2 0 0 0 1.9 1.2h.9a2 2 0 0 1 2 2v1a2 2 0 0 1-1.2 1.8l-.8.3a2 2 0 0 0-1.2 1.9l.1.9a2 2 0 0 1-1.4 2.1l-1 .3a2 2 0 0 1-2.2-.6l-.6-.6a2 2 0 0 0-2.8 0l-.6.6a2 2 0 0 1-2.2.6l-1-.3A2 2 0 0 1 4.7 17l.1-.9a2 2 0 0 0-1.2-1.9l-.8-.3A2 2 0 0 1 1.5 12v-1a2 2 0 0 1 2-2h.9a2 2 0 0 0 1.9-1.2l.3-.8A2 2 0 0 1 7.9 3.8l1-.3a2 2 0 0 1 2.2.6l.6.6a2 2 0 0 0 2.8 0l.6-.6a2 2 0 0 1 2.2-.6Z" />
    <circle cx="12" cy="12" r="3.25" />
  </>,
);

export const SearchIcon = createIcon(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </>,
);

export const FilterIcon = createIcon(
  <>
    <path d="M4 5h16" />
    <path d="M7 12h10" />
    <path d="M10 19h4" />
  </>,
);

export const BuildingIcon = createIcon(
  <>
    <path d="M3 21h18" />
    <path d="M5 21V7l7-4 7 4v14" />
    <path d="M9 10h.01" />
    <path d="M9 14h.01" />
    <path d="M15 10h.01" />
    <path d="M15 14h.01" />
    <path d="M11 21v-4h2v4" />
  </>,
);

export const FileTextIcon = createIcon(
  <>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
    <path d="M14 3v6h6" />
    <path d="M8 13h8" />
    <path d="M8 17h6" />
  </>,
);

export const SparkIcon = createIcon(
  <>
    <path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6Z" />
    <path d="m18.5 15 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z" />
    <path d="m4.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z" />
  </>,
);

export const ClockIcon = createIcon(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7v5l3 2" />
  </>,
);

export const BadgeIcon = createIcon(
  <>
    <path d="M12 3.5 5.5 6v5.6c0 4.1 2.7 7.7 6.5 8.9 3.8-1.2 6.5-4.8 6.5-8.9V6Z" />
    <path d="m9.5 12 1.7 1.7 3.3-3.7" />
  </>,
);

export const MoneyIcon = createIcon(
  <>
    <path d="M4 7h16v10H4z" />
    <path d="M8 12h.01" />
    <path d="M16 12h.01" />
    <circle cx="12" cy="12" r="2.5" />
  </>,
);

export const CalendarIcon = createIcon(
  <>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M8 3v4" />
    <path d="M16 3v4" />
    <path d="M3 10h18" />
  </>,
);

export const MoreIcon = createIcon(
  <>
    <circle cx="5" cy="12" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="19" cy="12" r="1.2" />
  </>,
);

export const PaperclipIcon = createIcon(
  <>
    <path d="m8 12.5 6.5-6.5a3 3 0 1 1 4.2 4.2l-8 8a5 5 0 1 1-7.1-7.1l8-8" />
  </>,
);

export const DownloadIcon = createIcon(
  <>
    <path d="M12 4v11" />
    <path d="m8 11 4 4 4-4" />
    <path d="M4 20h16" />
  </>,
);

export const LinkIcon = createIcon(
  <>
    <path d="M10 13a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-1 1" />
    <path d="M14 11a5 5 0 0 1 0 7l-1 1a5 5 0 0 1-7-7l1-1" />
  </>,
);

export const ArrowRightIcon = createIcon(
  <>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </>,
);

export const TrashIcon = createIcon(
  <>
    <path d="M4 7h16" />
    <path d="m10 11 .5 5" />
    <path d="m14 11-.5 5" />
    <path d="M6 7 7 19a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    <path d="M9 7V4h6v3" />
  </>,
);

export const PencilIcon = createIcon(
  <>
    <path d="m4 20 4.5-1 9.6-9.6a2.2 2.2 0 0 0-3.1-3.1L5.4 15.9 4 20Z" />
    <path d="m13.5 6.5 4 4" />
  </>,
);

export const EyeIcon = createIcon(
  <>
    <path d="M2.5 12s3.6-6 9.5-6 9.5 6 9.5 6-3.6 6-9.5 6-9.5-6-9.5-6Z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);

export const XIcon = createIcon(
  <>
    <path d="m6 6 12 12" />
    <path d="M18 6 6 18" />
  </>,
);
