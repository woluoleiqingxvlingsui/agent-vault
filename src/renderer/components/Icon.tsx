/**
 * 轻量内联图标集（stroke 风格，24x24，随 currentColor 变化），
 * 避免引入图标库，同时保证在高分屏下清晰。
 */
import type { SVGProps } from 'react'

export type IconName =
  | 'launch'
  | 'projects'
  | 'chat'
  | 'settings'
  | 'search'
  | 'plus'
  | 'edit'
  | 'trash'
  | 'refresh'
  | 'download'
  | 'upload'
  | 'external'
  | 'check'
  | 'alert'
  | 'clock'
  | 'folder'
  | 'terminal'
  | 'app'
  | 'close'
  | 'database'
  | 'sparkle'
  | 'chevron'
  | 'sun'
  | 'moon'
  | 'eye'

const PATHS: Record<IconName, string[]> = {
  launch: ['M5 12h9', 'M11 5l7 7-7 7'],
  projects: [
    'M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9A1.5 1.5 0 0 1 21 10v7.5A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5Z'
  ],
  chat: ['M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z', 'M8 9h8', 'M8 12.5h5'],
  settings: [
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
    'M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15H4.5a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 11.5 4.6V4.5a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 11h.1a2 2 0 1 1 0 4Z'
  ],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'M20 20l-4-4'],
  plus: ['M12 5v14', 'M5 12h14'],
  edit: ['M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5Z', 'M13.5 6.5 17.5 10.5'],
  trash: ['M4 7h16', 'M10 7V5h4v2', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
  refresh: ['M20 12a8 8 0 1 1-2.34-5.66', 'M20 4v4h-4'],
  download: ['M12 4v11', 'M7 11l5 5 5-5', 'M5 20h14'],
  upload: ['M12 20V9', 'M7 13l5-5 5 5', 'M5 20h14'],
  external: ['M14 4h6v6', 'M20 4l-8 8', 'M18 14v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  check: ['M5 13l4 4L19 7'],
  alert: ['M12 8v5', 'M12 17h.01', 'M12 3 2.5 20h19Z'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7.5V12l3.5 2'],
  folder: ['M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9A1.5 1.5 0 0 1 21 10v7.5A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5Z'],
  terminal: ['M5 5h14v14H5z', 'M8 10l2.5 2.5L8 15', 'M13 15h3'],
  app: ['M5 4h14v16H5z', 'M9 8h6', 'M9 12h6', 'M9 16h3'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  database: ['M12 3c4.4 0 8 1.1 8 2.5S16.4 8 12 8 4 6.9 4 5.5 7.6 3 12 3Z', 'M20 5.5v13c0 1.4-3.6 2.5-8 2.5s-8-1.1-8-2.5v-13', 'M20 12c0 1.4-3.6 2.5-8 2.5S4 13.4 4 12'],
  sparkle: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z', 'M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8Z'],
  chevron: ['M9 6l6 6-6 6'],
  sun: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z', 'M12 2v2', 'M12 20v2', 'M2 12h2', 'M20 12h2', 'M5 5l1.5 1.5', 'M17.5 17.5 19 19', 'M19 5l-1.5 1.5', 'M6.5 17.5 5 19'],
  moon: ['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z'],
  eye: ['M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z']
}

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 16, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
