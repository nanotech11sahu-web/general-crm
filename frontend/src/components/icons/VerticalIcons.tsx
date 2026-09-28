type IconProps = { className?: string };

export function HrmsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="hrms-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5B7CFA" />
          <stop offset="1" stopColor="#3454E0" />
        </linearGradient>
        <linearGradient id="hrms-body2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#B9C6FF" />
          <stop offset="1" stopColor="#8FA3FA" />
        </linearGradient>
      </defs>
      <circle cx="21" cy="18" r="8" fill="url(#hrms-body2)" />
      <circle cx="43" cy="18" r="7" fill="url(#hrms-body2)" opacity="0.8" />
      <path d="M8 40c0-8 6-13 13-13s13 5 13 13v2H8z" fill="url(#hrms-body2)" opacity="0.85" />
      <circle cx="32" cy="24" r="10" fill="url(#hrms-body)" />
      <path d="M14 52c0-10 8-16 18-16s18 6 18 16v3H14z" fill="url(#hrms-body)" />
      <rect x="10" y="30" width="26" height="19" rx="4" fill="white" opacity="0.9" />
      <rect x="14" y="34" width="8" height="8" rx="2" fill="url(#hrms-body)" />
      <rect x="25" y="35" width="8" height="2" rx="1" fill="#C7D2FE" />
      <rect x="25" y="39" width="8" height="2" rx="1" fill="#C7D2FE" />
      <rect x="14" y="44" width="19" height="2" rx="1" fill="#C7D2FE" />
    </svg>
  );
}

export function FinanceIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="fin-calc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#233150" />
          <stop offset="1" stopColor="#111A30" />
        </linearGradient>
        <linearGradient id="fin-coin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFD873" />
          <stop offset="1" stopColor="#F5A623" />
        </linearGradient>
      </defs>
      <rect x="8" y="14" width="26" height="34" rx="5" fill="url(#fin-calc)" />
      <rect x="12" y="18" width="18" height="7" rx="2" fill="#7CF2C4" />
      {[0, 1, 2].map((row) =>
        [0, 1, 2].map((col) => (
          <rect key={`${row}-${col}`} x={13 + col * 6} y={29 + row * 6} width="4" height="4" rx="1" fill="#4C5C82" />
        )),
      )}
      <path d="M30 44l12-16 6 6-12 16z" fill="#3EDBA3" opacity="0.35" />
      <path d="M22 46l6-8 5 4 9-12" stroke="#1FA971" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="46" cy="42" r="11" fill="url(#fin-coin)" />
      <circle cx="46" cy="42" r="7.5" fill="none" stroke="#B9781A" strokeWidth="1.5" opacity="0.6" />
      <text x="46" y="46" textAnchor="middle" fontSize="10" fontWeight="700" fill="#8A5A0F">
        $
      </text>
      <circle cx="37" cy="50" r="6" fill="url(#fin-coin)" opacity="0.85" />
    </svg>
  );
}

export function LeadsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <radialGradient id="leads-ring" cx="0.35" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#7FA8FF" />
          <stop offset="1" stopColor="#2E6FE8" />
        </radialGradient>
      </defs>
      <circle cx="27" cy="30" r="20" fill="url(#leads-ring)" />
      <circle cx="27" cy="30" r="14" fill="white" opacity="0.9" />
      <circle cx="27" cy="30" r="8.5" fill="url(#leads-ring)" opacity="0.85" />
      <circle cx="27" cy="30" r="3.5" fill="white" />
      <path d="M46 12l-14 22 4 4 22-14z" fill="#233150" />
      <circle cx="32" cy="34" r="3" fill="#233150" />
      <circle cx="44" cy="46" r="10" fill="#3454E0" />
      <path d="M39 47.5c0-3 2.3-5 5-5s5 2 5 5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="44" cy="41.5" r="2.6" fill="white" />
    </svg>
  );
}

export function MeetingsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="meet-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#B07CF0" />
          <stop offset="1" stopColor="#7A3FC9" />
        </linearGradient>
      </defs>
      <rect x="9" y="14" width="34" height="34" rx="7" fill="url(#meet-body)" />
      <rect x="9" y="14" width="34" height="10" rx="7" fill="#5C2AA6" />
      <rect x="15" y="9" width="4" height="10" rx="2" fill="#5C2AA6" />
      <rect x="33" y="9" width="4" height="10" rx="2" fill="#5C2AA6" />
      {[0, 1].map((row) =>
        [0, 1, 2].map((col) => (
          <rect key={`${row}-${col}`} x={15 + col * 8} y={29 + row * 8} width="5" height="5" rx="1.5" fill="white" opacity={row === 0 && col === 1 ? 1 : 0.55} />
        )),
      )}
      <circle cx="46" cy="42" r="13" fill="#FBEFE0" />
      <circle cx="46" cy="42" r="13" fill="none" stroke="#7A3FC9" strokeWidth="2.5" />
      <path d="M46 35v7l5 4" stroke="#7A3FC9" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="settings-gear" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8592AC" />
          <stop offset="1" stopColor="#4B5A76" />
        </linearGradient>
      </defs>
      <g fill="url(#settings-gear)">
        {Array.from({ length: 8 }).map((_, i) => (
          <rect key={i} x="29.5" y="6" width="5" height="13" rx="2.5" transform={`rotate(${i * 45} 32 32)`} />
        ))}
      </g>
      <circle cx="32" cy="32" r="17" fill="url(#settings-gear)" />
      <circle cx="32" cy="32" r="12" fill="#EEF1F6" />
      <circle cx="32" cy="32" r="5.5" fill="url(#settings-gear)" />
    </svg>
  );
}

export function OperationsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="ops-box" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F0B368" />
          <stop offset="1" stopColor="#DE8A2C" />
        </linearGradient>
        <linearGradient id="ops-boxTop" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FBD9A5" />
          <stop offset="1" stopColor="#F0B368" />
        </linearGradient>
      </defs>
      <path d="M10 24l16-8 16 8v18l-16 8-16-8z" fill="url(#ops-box)" />
      <path d="M10 24l16 8 16-8-16-8z" fill="url(#ops-boxTop)" />
      <path d="M26 32v18" stroke="#B96A17" strokeWidth="1.5" opacity="0.5" />
      <rect x="18" y="26" width="4" height="9" fill="#B96A17" opacity="0.5" />
      <rect x="36" y="14" width="18" height="24" rx="3" fill="white" />
      <rect x="36" y="14" width="18" height="24" rx="3" fill="none" stroke="#E2E8F0" strokeWidth="1.5" />
      <path d="M40 22l3 3 6-6" stroke="#1FA971" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="40" y="29" width="10" height="2" rx="1" fill="#CBD5E1" />
      <path d="M40 34l3 3 6-6" stroke="#1FA971" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="41" y="10" width="8" height="5" rx="1.5" fill="#E2E8F0" />
    </svg>
  );
}
