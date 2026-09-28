import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { VERTICALS, type Vertical } from '../config/verticals';

const ACCENT_CLASSES: Record<string, { badge: string; arrowBg: string; arrowIcon: string }> = {
  violet: { badge: 'bg-[#ECE7FE]', arrowBg: 'bg-[#ECE7FE]', arrowIcon: 'text-[#6C4DF6]' },
  emerald: { badge: 'bg-[#DCF6E9]', arrowBg: 'bg-[#DCF6E9]', arrowIcon: 'text-[#1FA971]' },
  blue: { badge: 'bg-[#DDEBFE]', arrowBg: 'bg-[#DDEBFE]', arrowIcon: 'text-[#2E6FE8]' },
  purple: { badge: 'bg-[#F6E4F7]', arrowBg: 'bg-[#ECE7FE]', arrowIcon: 'text-[#6C4DF6]' },
  amber: { badge: 'bg-[#FCEBD5]', arrowBg: 'bg-[#FCEBD5]', arrowIcon: 'text-[#DE8A2C]' },
  slate: { badge: 'bg-[#E4E8F0]', arrowBg: 'bg-[#E4E8F0]', arrowIcon: 'text-[#4B5A76]' },
};

function VerticalCard({ vertical, onClick }: { vertical: Vertical; onClick: () => void }) {
  const accent = ACCENT_CLASSES[vertical.accent];
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex min-h-[260px] w-full flex-col items-start rounded-[28px] bg-white p-8 text-left shadow-[0_10px_30px_-12px_rgba(30,41,59,0.15)] transition-transform hover:-translate-y-1 sm:w-[calc(50%-0.75rem)] lg:w-[calc(33.333%-1rem)]"
    >
      <span className={`flex h-24 w-24 items-center justify-center rounded-full ${accent.badge}`}>
        <vertical.icon className="h-20 w-20" />
      </span>
      <p className="mt-6 text-2xl font-bold text-[#1E2A45]">{vertical.label}</p>
      <span className={`absolute bottom-6 right-6 flex h-11 w-11 items-center justify-center rounded-full ${accent.arrowBg} transition-transform group-hover:translate-x-1`}>
        <ArrowRight className={`h-5 w-5 ${accent.arrowIcon}`} aria-hidden />
      </span>
    </button>
  );
}

export function HubPage() {
  const navigate = useNavigate();
  const topRow = VERTICALS.slice(0, 3);
  const bottomRow = VERTICALS.slice(3);

  return (
    <div className="relative min-h-full overflow-hidden bg-[#F3F6FC]">
      <div
        className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[720px] rotate-12 bg-gradient-to-br from-white/70 to-transparent"
        aria-hidden
      />
      <div className="relative mx-auto flex max-w-5xl flex-col gap-6 px-6 py-14">
        <div className="flex flex-col gap-6 sm:flex-row sm:flex-wrap">
          {topRow.map((vertical) => (
            <VerticalCard key={vertical.key} vertical={vertical} onClick={() => navigate(vertical.homePath)} />
          ))}
        </div>
        <div className="flex flex-col justify-center gap-6 sm:flex-row sm:flex-wrap">
          {bottomRow.map((vertical) => (
            <VerticalCard key={vertical.key} vertical={vertical} onClick={() => navigate(vertical.homePath)} />
          ))}
        </div>
      </div>
    </div>
  );
}
