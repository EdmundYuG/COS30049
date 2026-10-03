/**
 * Inline stroke icons, 24x24, currentColor.
 * Kept local so the prototype has no icon-font or CDN dependency.
 */

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

function Svg({ children, className = 'ico', ...rest }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...S} {...rest}>
      {children}
    </svg>
  );
}

export const Leaf = (p) => (
  <Svg {...p}><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" /><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" /></Svg>
);
export const Search = (p) => (<Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></Svg>);
export const Home = (p) => (<Svg {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.8V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.8" /><path d="M9.5 21v-6h5v6" /></Svg>);
export const QrIcon = (p) => (
  <Svg {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><path d="M14 14h3v3h-3zM20 14v.01M14 20v.01M17.5 20.5h3.5V17" /></Svg>
);
export const Scan = (p) => (
  <Svg {...p}><path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" /><path d="M3 12h18" /></Svg>
);
export const Plus = (p) => (<Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>);
export const List = (p) => (<Svg {...p}><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></Svg>);
export const Grid = (p) => (<Svg {...p}><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></Svg>);
export const Check = (p) => (<Svg {...p}><path d="m4.5 12.5 5 5 10-11" /></Svg>);
export const CheckCircle = (p) => (<Svg {...p}><circle cx="12" cy="12" r="9" /><path d="m8 12.3 2.8 2.8L16 9.5" /></Svg>);
export const X = (p) => (<Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>);
export const XCircle = (p) => (<Svg {...p}><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></Svg>);
export const Clock = (p) => (<Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></Svg>);
export const Archive = (p) => (<Svg {...p}><rect x="3" y="4" width="18" height="4.5" rx="1.5" /><path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5" /><path d="M10 12.5h4" /></Svg>);
export const Users = (p) => (<Svg {...p}><circle cx="9" cy="8" r="3.4" /><path d="M2.8 20c.4-3.4 3-5.6 6.2-5.6s5.8 2.2 6.2 5.6" /><path d="M16.5 5.2a3.4 3.4 0 0 1 0 6.5" /><path d="M18 14.8c2.2.6 3.6 2.5 3.9 5.2" /></Svg>);
export const User = (p) => (<Svg {...p}><circle cx="12" cy="8" r="3.6" /><path d="M4.8 20.5c.5-3.7 3.4-6.1 7.2-6.1s6.7 2.4 7.2 6.1" /></Svg>);
export const Activity = (p) => (<Svg {...p}><path d="M3 12.5h4l2.5-7 4.5 14 2.6-7H21" /></Svg>);
export const Settings = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.2 14.4a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-1 1.46V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.46 1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.46-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.46-1 1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.77.32H9a1.6 1.6 0 0 0 1-1.46V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.46 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1.77V9a1.6 1.6 0 0 0 1.46 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.46 1Z" /></Svg>
);
export const Bell = (p) => (<Svg {...p}><path d="M18 8.5a6 6 0 1 0-12 0c0 6-2 7.5-2 7.5h16s-2-1.5-2-7.5" /><path d="M13.7 20a2 2 0 0 1-3.4 0" /></Svg>);
export const ChevronRight = (p) => (<Svg {...p}><path d="m9 5 7 7-7 7" /></Svg>);
export const ChevronLeft = (p) => (<Svg {...p}><path d="m15 5-7 7 7 7" /></Svg>);
export const ChevronDown = (p) => (<Svg {...p}><path d="m5 9 7 7 7-7" /></Svg>);
export const ArrowLeft = (p) => (<Svg {...p}><path d="M20 12H4M10 6l-6 6 6 6" /></Svg>);
export const MapPin = (p) => (<Svg {...p}><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" /><circle cx="12" cy="10" r="2.6" /></Svg>);
export const Camera = (p) => (<Svg {...p}><path d="M4 8h3l1.6-2.4h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" /><circle cx="12" cy="13.5" r="3.6" /></Svg>);
export const Image = (p) => (<Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.8" /><path d="m4 17 4.5-4.5 3 3L15.5 11 20 15.5" /></Svg>);
export const Edit = (p) => (<Svg {...p}><path d="M4 20h4l10-10a2.6 2.6 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></Svg>);
export const Download = (p) => (<Svg {...p}><path d="M12 3v12" /><path d="m7.5 11 4.5 4.5 4.5-4.5" /><path d="M4 20h16" /></Svg>);
export const Printer = (p) => (<Svg {...p}><path d="M7 9V3.5h10V9" /><rect x="3" y="9" width="18" height="7.5" rx="1.6" /><path d="M7 14h10v6.5H7z" /></Svg>);
export const Eye = (p) => (<Svg {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></Svg>);
export const Alert = (p) => (<Svg {...p}><path d="M12 4.5 2.8 20h18.4L12 4.5Z" /><path d="M12 10v4M12 17.3v.01" /></Svg>);
export const Info = (p) => (<Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.8v.01" /></Svg>);
export const Logout = (p) => (<Svg {...p}><path d="M14 20H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h8" /><path d="M17 15.5 20.5 12 17 8.5" /><path d="M20 12H9.5" /></Svg>);
export const Sun = (p) => (<Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" /></Svg>);
export const Moon = (p) => (<Svg {...p}><path d="M20 14.2A8.3 8.3 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2Z" /></Svg>);
/** Half light, half dark: "follow the device". */
export const ThemeAuto = (p) => (<Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" stroke="none" /></Svg>);
export const Filter =(p) => (<Svg {...p}><path d="M3 5.5h18l-7 8V20l-4 1.5v-8Z" /></Svg>);
export const Sensor = (p) => (<Svg {...p}><path d="M12 13.5V21" /><circle cx="12" cy="10" r="2.4" /><path d="M8.2 14a5.4 5.4 0 0 1 0-8M15.8 6a5.4 5.4 0 0 1 0 8" /><path d="M5.6 16.8a9 9 0 0 1 0-13.6M18.4 3.2a9 9 0 0 1 0 13.6" /></Svg>);
export const Shield = (p) => (<Svg {...p}><path d="M12 3 5 6v6c0 4.4 3 7.9 7 9 4-1.1 7-4.6 7-9V6l-7-3Z" /><path d="m9.2 12 2 2 3.6-3.8" /></Svg>);
export const Menu = (p) => (<Svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>);
export const Copy = (p) => (<Svg {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5.5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1.5" /></Svg>);
export const Refresh = (p) => (<Svg {...p}><path d="M20 11a8 8 0 1 0-.9 5" /><path d="M20 4.5V11h-6.5" /></Svg>);
export const External = (p) => (<Svg {...p}><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4.5" /></Svg>);
export const Flag = (p) => (<Svg {...p}><path d="M5 21V4" /><path d="M5 4.8h12.5l-2.2 4 2.2 4H5" /></Svg>);
export const Book = (p) => (<Svg {...p}><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v15H5.5A1.5 1.5 0 0 0 4 19.5Z" /><path d="M4 19.5A1.5 1.5 0 0 1 5.5 21H19v-3" /></Svg>);
export const Phone = (p) => (<Svg {...p}><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></Svg>);
export const Compass = (p) => (<Svg {...p}><circle cx="12" cy="12" r="9" /><path d="m15.2 8.8-1.7 4.7-4.7 1.7 1.7-4.7Z" /></Svg>);
export const Sprout = (p) => (<Svg {...p}><path d="M12 21v-7" /><path d="M12 14c0-3.3 2-5.5 5.5-5.8 0 3.3-2 5.5-5.5 5.8Z" /><path d="M12 15.5c0-3-1.8-5-5-5.3 0 3 1.8 5 5 5.3Z" /></Svg>);
export const Tree = (p) => (<Svg {...p}><path d="M12 21v-5" /><path d="M12 16 7 13h2.2L6 9.8h2.4L12 4l3.6 5.8H18L14.8 13H17l-5 3Z" /></Svg>);
