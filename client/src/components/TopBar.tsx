import type { ReactNode } from 'react';
import { navigate, type Me } from '../App';
import { api } from '../api';

export function Logo({ className = 'h-6' }: { className?: string }) {
  return <img src="/library/brand/logo.png" alt="Impact Signs" className={className} />;
}

export function TopBar({ me, center, right }: { me: Me; center?: ReactNode; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white">
      <div className="flex h-14 items-center gap-4 px-4 md:px-5">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
          className="flex shrink-0 items-center gap-3"
        >
          <Logo />
          <span className="hidden h-5 w-px bg-line sm:block" />
          <span className="hidden font-display text-[15px] font-semibold uppercase tracking-[0.08em] text-ink sm:block">Plaque Proof Studio</span>
        </a>
        <div className="min-w-0 flex-1">{center}</div>
        <div className="flex shrink-0 items-center gap-3 text-[13px]">
          {right}
          {me.mock && (
            <span className="hidden rounded-[3px] border border-amber/30 bg-amber-50 px-2 py-0.5 font-display text-[11px] font-semibold uppercase tracking-wider text-amber md:inline" title="MOCK_AI=1: images are simulated, no OpenAI calls">
              Demo mode
            </span>
          )}
          <a
            href="/admin"
            onClick={(e) => {
              e.preventDefault();
              navigate('/admin');
            }}
            className="text-graphite hover:text-navy"
          >
            Admin
          </a>
          {me.passwordRequired && (
            <button
              className="text-graphite hover:text-navy"
              onClick={async () => {
                await api.post('/logout');
                window.location.href = '/';
              }}
              title={`Signed in as ${me.user?.name}`}
            >
              Sign out
            </button>
          )}
        </div>
      </div>
      <div className="h-[3px] bg-navy" />
    </header>
  );
}
