import type { ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { Icon, type IconName } from "./icons";
import { Logo, cx } from "./ui";
import { AppearanceButton } from "./AppearancePanel";
import { useT } from "../lib/i18n";

export type NavItem = { to: string; label: string; icon: IconName; end?: boolean };

type Props = {
  nav: NavItem[];
  roleLabel: string;
  /**
   * How navigation looks on phones (< 768px):
   * "mobile" = floating bottom bar (patients, front desk); "sidebar" = scrollable pill tabs.
   * Tablets get pill tabs under the top bar; laptops (>= 1024px) always get the sidebar.
   */
  variant: "mobile" | "sidebar";
  onLogout?: () => void;
  headerExtra?: ReactNode;
};

/** Shared responsive layout used by every role, so each role layout is just a nav config. */
export function AppShell({ nav, roleLabel, variant, onLogout, headerExtra }: Props) {
  const { pathname } = useLocation();
  const t = useT();
  const bottomNav = variant === "mobile";

  return (
    <div className="flex min-h-screen">
      {/* ── Laptop / desktop: sidebar ── */}
      <aside className="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col border-r border-slate-200/80 bg-surface/85 px-4 py-5 backdrop-blur-xl lg:flex">
        <div className="px-2">
          <Logo />
        </div>
        <p className="mt-6 px-3 text-[11px] font-bold uppercase tracking-[0.16em] text-muted">{t("{role} workspace", { role: t(roleLabel) })}</p>
        {headerExtra && <div className="mt-3 px-1">{headerExtra}</div>}
        <nav aria-label={t("Main")} className="mt-3 flex flex-1 flex-col gap-1">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {({ isActive }) => (
                <span
                  className={cx(
                    "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
                    isActive ? "text-brand-700" : "text-muted hover:bg-slate-50 hover:text-ink",
                  )}
                >
                  {isActive && (
                    <motion.span
                      layoutId="side-nav-pill"
                      className="absolute inset-0 rounded-xl bg-brand-50 ring-1 ring-brand-100"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span
                    className={cx(
                      "relative grid h-8 w-8 place-items-center rounded-lg transition",
                      isActive ? "bg-brand-gradient text-white shadow-glow" : "bg-slate-100 text-slate-500 group-hover:text-brand-600",
                    )}
                  >
                    <Icon name={item.icon} className="h-[18px] w-[18px]" />
                  </span>
                  <span className="relative">{t(item.label)}</span>
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-200 pt-3">
          <AppearanceButton tone="sidebar" withLabel />
        </div>
        {onLogout && (
          <button
            onClick={onLogout}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-muted transition hover:bg-danger-soft hover:text-danger"
          >
            <Icon name="logout" className="h-[18px] w-[18px]" />
            {t("Log out")}
          </button>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── Phone & tablet: top bar (+ pill tabs) ── */}
        <div className="sticky top-0 z-20 lg:hidden">
          <TopBar roleLabel={roleLabel} onLogout={onLogout} extra={headerExtra} />
          <nav
            aria-label={t("Main")}
            className={cx(
              "no-scrollbar gap-2 overflow-x-auto border-b border-slate-200/70 bg-surface/85 px-4 py-2.5 backdrop-blur-xl sm:px-6",
              bottomNav ? "hidden md:flex" : "flex",
            )}
          >
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cx(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition-all",
                    isActive ? "bg-brand-600 text-white shadow-glow" : "bg-surface text-slate-600 ring-1 ring-slate-200",
                  )
                }
              >
                <Icon name={item.icon} className="h-4 w-4" />
                {t(item.label)}
              </NavLink>
            ))}
          </nav>
        </div>

        <main className={cx("mx-auto w-full max-w-6xl flex-1 px-4 pt-5 sm:px-6 md:pb-10 lg:px-10 lg:pt-10", bottomNav ? "pb-32" : "pb-10")}>
          <motion.div key={pathname} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
            <Outlet />
          </motion.div>
        </main>
      </div>

      {/* ── Phone only: floating bottom bar ── */}
      {bottomNav && (
        <nav aria-label={t("Main")} className="fixed inset-x-0 bottom-4 z-30 mx-auto w-[calc(100%-2rem)] max-w-sm md:hidden">
          <div className="flex gap-1 rounded-2xl border border-slate-200/80 bg-surface/90 p-1.5 shadow-float backdrop-blur-xl">
            {nav.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className="relative flex-1">
                {({ isActive }) => (
                  <span
                    className={cx(
                      "relative flex flex-col items-center gap-0.5 rounded-xl py-2 text-[11px] font-semibold transition-colors",
                      isActive ? "text-white" : "text-muted hover:text-ink",
                    )}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="bottom-nav-pill"
                        className="absolute inset-0 rounded-xl bg-brand-gradient shadow-glow"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    <Icon name={item.icon} className="relative h-5 w-5" />
                    <span className="relative">{t(item.label)}</span>
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}

function TopBar({ roleLabel, onLogout, extra }: { roleLabel: string; onLogout?: () => void; extra?: ReactNode }) {
  const t = useT();
  return (
    <header className="flex items-center justify-between gap-3 border-b border-slate-200/70 bg-surface/85 px-4 py-3 backdrop-blur-xl">
      <div className="flex items-center gap-2.5">
        <Logo size="sm" />
        <span className="hidden rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-brand-700 sm:inline">
          {t(roleLabel)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {extra}
        <AppearanceButton />
        {onLogout && (
          <button
            onClick={onLogout}
            aria-label={t("Log out")}
            className="grid h-10 w-10 place-items-center rounded-xl text-muted transition hover:bg-danger-soft hover:text-danger"
          >
            <Icon name="logout" />
          </button>
        )}
      </div>
    </header>
  );
}
