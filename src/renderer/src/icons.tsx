import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

export const LogoMark = (props: IconProps) => (
  <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" {...props}>
    <defs>
      <linearGradient id="logo-mark-background" x1="10" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse">
        <stop stopColor="#6674F6" />
        <stop offset="1" stopColor="#3437BD" />
      </linearGradient>
      <linearGradient id="logo-mark-fold" x1="18" y1="21" x2="48" y2="49" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FFFFFF" />
        <stop offset="1" stopColor="#E9EAFF" />
      </linearGradient>
    </defs>
    <rect x="4" y="4" width="56" height="56" rx="15" fill="url(#logo-mark-background)" />
    <path d="M13 22.5a5 5 0 0 1 5-5h9.2c1.3 0 2.5.5 3.4 1.4l2.6 2.6H46a5 5 0 0 1 5 5v17a5 5 0 0 1-5 5H18a5 5 0 0 1-5-5v-21Z" fill="url(#logo-mark-fold)" />
    <rect x="21" y="29" width="8" height="7" rx="2" fill="#5157DB" />
    <rect x="34" y="29" width="9" height="7" rx="2" fill="#5157DB" />
    <rect x="21" y="39" width="8" height="6" rx="2" fill="#5157DB" />
    <rect x="34" y="39" width="9" height="6" rx="2" fill="#5157DB" />
  </svg>
)

const Icon = ({ children, ...props }: IconProps) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
    {children}
  </svg>
)

export const FolderIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 6.8a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8.7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
  </Icon>
)

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v8M8 12h8" />
  </Icon>
)

export const ClockIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </Icon>
)

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
)

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
)

export const GridIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <rect x="14" y="14" width="6" height="6" rx="1" />
  </Icon>
)

export const ListIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="M4 6h.01M4 12h.01M4 18h.01" strokeWidth="2.8" strokeLinecap="round" />
  </Icon>
)

export const SettingsIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
  </Icon>
)

export const CodeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 5l-3 14" />
  </Icon>
)

export const GitBranchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="6" cy="5" r="2" />
    <circle cx="18" cy="7" r="2" />
    <circle cx="6" cy="19" r="2" />
    <path d="M6 7v10M8 9h4a6 6 0 0 0 6-6v2" />
  </Icon>
)

export const EditIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-4-4l-10 10Z" />
    <path d="m13.5 6.5 4 4" />
  </Icon>
)

export const TrashIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 7h15M9 7V4.5h6V7M7 7l.8 12h8.4L17 7" />
    <path d="M10 10.5v5M14 10.5v5" />
  </Icon>
)
