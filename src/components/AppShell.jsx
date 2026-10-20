// ============================================================
// AppShell.jsx
//
// Persistent layout shell used across StudyHub routes.
// Hosts the desktop/tablet sidebar and mobile BottomNav around <Outlet />.
//
// Breakpoint Contract:
//   < 768px    — Mobile: Sidebar hidden; BottomNav rendered at bottom.
//   768–1023px — Tablet: Collapsed 68px icon rail, expandable on click.
//   ≥ 1024px   — Desktop: Fixed 250px full sidebar with branding, groups, and profile.
// ============================================================

import React, { memo, useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { supabase } from '../supabase';
import { BottomNav } from './BottomNav';
import {
  PRIMARY_NAV,
  SECONDARY_NAV,
  ACCOUNT_NAV,
} from '../config/navigation';

// ─── Section Header ──────────────────────────────────────────
const NavSection = ({ label, children }) => (
  <div className="space-y-1">
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 pb-1 select-none">
      {label}
    </p>
    <ul className="space-y-0.5">{children}</ul>
  </div>
);

// ─── Full Sidebar Nav Item ───────────────────────────────────
const SidebarItem = memo(({ to, icon: Icon, label, end, onClick }) => (
  <li>
    <NavLink
      to={to}
      end={end}
      prefetch="intent"
      onClick={onClick}
      className={({ isActive }) =>
        [
          'group flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm transition-all duration-150 select-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600',
          isActive
            ? 'bg-blue-50 text-blue-600 font-semibold shadow-xs'
            : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-900 font-medium',
        ].join(' ')
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={[
              'flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150',
              isActive
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-transparent text-slate-400 group-hover:bg-slate-100 group-hover:text-slate-700',
            ].join(' ')}
          >
            <Icon size={17} strokeWidth={isActive ? 2.5 : 1.75} />
          </span>
          <span className="truncate leading-none">{label}</span>
        </>
      )}
    </NavLink>
  </li>
));

// ─── Slim Rail Nav Item (Tablet) ─────────────────────────────
const RailItem = memo(({ to, icon: Icon, label, end }) => (
  <li>
    <NavLink
      to={to}
      end={end}
      prefetch="intent"
      title={label}
      aria-label={label}
      className={({ isActive }) =>
        [
          'flex items-center justify-center w-11 h-11 mx-auto rounded-xl transition-all duration-150 select-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600',
          isActive
            ? 'bg-blue-600 text-white shadow-sm'
            : 'text-slate-400 hover:text-slate-800 hover:bg-slate-100',
        ].join(' ')
      }
    >
      {({ isActive }) => (
        <Icon size={19} strokeWidth={isActive ? 2.5 : 1.75} />
      )}
    </NavLink>
  </li>
));

// ─── Avatar ───────────────────────────────────────────────────
const UserAvatar = memo(({ src, initials = 'U', size = 8 }) => {
  const [imgOk, setImgOk] = useState(!!src);
  useEffect(() => { setImgOk(!!src); }, [src]);

  const base = `rounded-full border-2 border-blue-600/30 object-cover flex-shrink-0`;
  const dim  = `w-${size} h-${size}`;

  if (imgOk && src) {
    return (
      <img
        src={src}
        alt="Profile"
        className={`${base} ${dim}`}
        onError={() => setImgOk(false)}
        loading="eager"
      />
    );
  }
  return (
    <div className={`${base} ${dim} bg-blue-600 flex items-center justify-center text-white font-bold text-xs shadow-xs`}>
      {initials || 'U'}
    </div>
  );
});

// ─── AppShell Component ──────────────────────────────────────
export const AppShell = memo(function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();

  // Tablet drawer expansion state (768–1023px)
  const [tabletExpanded, setTabletExpanded] = useState(false);

  // User profile state loaded from cache + synced with Supabase
  const [profile, setProfile] = useState(() => {
    try {
      const cached = JSON.parse(localStorage.getItem('homeDashboardCache') || '{}');
      const u = cached?.userData || {};
      const pic = localStorage.getItem('userProfilePic') || u.avatar_url || '';
      return {
        displayName: u.displayName || u.full_name || 'Student',
        role: u.role || 'LUANAR Student',
        initials: (u.displayName || u.full_name || 'U').slice(0, 2).toUpperCase(),
        profilePicSrc: pic,
      };
    } catch {
      return { displayName: 'Student', role: 'LUANAR Student', initials: 'U', profilePicSrc: '' };
    }
  });

  // Sync latest user profile on mount
  useEffect(() => {
    let isMounted = true;
    async function syncProfile() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;
        const { data } = await supabase
          .from('profiles')
          .select('name, profile_pic, role')
          .eq('id', session.user.id)
          .maybeSingle();

        if (isMounted && data) {
          const rawName = data.name || session.user.email?.split('@')[0] || 'Student';
          // Format as "First L." (title-cased)
          const parts = rawName.trim().split(/\s+/).filter(Boolean);
          let formattedName = rawName;
          if (parts.length > 1) {
            const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
            const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase() + '.';
            formattedName = `${first} ${lastInitial}`;
          } else if (parts.length === 1) {
            formattedName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
          }

          const pic = data.profile_pic || localStorage.getItem('userProfilePic') || '';
          setProfile({
            displayName: formattedName,
            role: data.role || 'LUANAR Student',
            initials: rawName.slice(0, 2).toUpperCase(),
            profilePicSrc: pic,
          });
        }
      } catch {}
    }
    syncProfile();
    return () => { isMounted = false; };
  }, []);

  // Auto-collapse expanded tablet sidebar on navigation
  useEffect(() => {
    setTabletExpanded(false);
  }, [location.pathname]);

  const allNavItems = [...PRIMARY_NAV, ...SECONDARY_NAV, ...ACCOUNT_NAV];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-900 antialiased font-sans">
      
      {/* ─── DESKTOP FULL SIDEBAR (≥1024px) ─── */}
      <aside
        className={[
          'hidden lg:flex flex-col w-[250px] flex-shrink-0',
          'h-full bg-white border-r border-slate-200/80',
          'shadow-[1px_0_4px_0_rgba(0,0,0,0.02)] z-30',
        ].join(' ')}
      >
        {/* Brand header */}
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-slate-100 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg overflow-hidden bg-blue-600 flex-shrink-0 shadow-xs">
            <img src="/images/luanar7.png" alt="LUANAR" className="w-full h-full object-cover" loading="eager" />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold leading-none text-[17px] text-slate-900 flex items-center gap-2" style={{ letterSpacing: '-0.01em' }}>
              StudyHub
              <span className="text-blue-600 bg-blue-50 font-bold text-[10px] px-2 py-0.5 rounded-full tracking-wider uppercase">
                LUANAR
              </span>
            </h1>
          </div>
        </div>

        {/* Navigation sections */}
        <nav className="flex-1 overflow-y-auto px-3.5 py-4 space-y-6">
          <NavSection label="Study">
            {PRIMARY_NAV.map(item => (
              <SidebarItem key={item.to} {...item} />
            ))}
          </NavSection>

          <NavSection label="More">
            {SECONDARY_NAV.map(item => (
              <SidebarItem key={item.to} {...item} />
            ))}
          </NavSection>

          <NavSection label="Account">
            {ACCOUNT_NAV.map(item => (
              <SidebarItem key={item.to} {...item} />
            ))}
          </NavSection>
        </nav>

        {/* User profile card at the bottom */}
        <div className="flex-shrink-0 border-t border-slate-100 p-3">
          <button
            onClick={() => navigate('/profile')}
            className={[
              'w-full flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 bg-slate-50/50',
              'hover:bg-slate-100/70 hover:border-slate-200 transition-all duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600',
              'text-left cursor-pointer',
            ].join(' ')}
            title="View profile"
          >
            <UserAvatar src={profile.profilePicSrc} initials={profile.initials} size={8} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate leading-tight">{profile.displayName}</p>
              <p className="text-[11px] text-slate-400 truncate leading-tight mt-0.5">{profile.role}</p>
            </div>
          </button>
        </div>
      </aside>

      {/* ─── TABLET SLIM RAIL (768–1023px) ─── */}
      <aside
        className={[
          'hidden md:flex lg:hidden flex-col w-[68px] flex-shrink-0',
          'h-full bg-white border-r border-slate-200/80',
          'shadow-[1px_0_4px_0_rgba(0,0,0,0.02)] z-30',
        ].join(' ')}
      >
        {/* Brand seal & expand button */}
        <div className="flex flex-col items-center py-3.5 border-b border-slate-100 flex-shrink-0 gap-2">
          <div className="w-8 h-8 rounded-lg overflow-hidden bg-blue-600 shadow-xs">
            <img src="/images/luanar7.png" alt="LUANAR" className="w-full h-full object-cover" loading="eager" />
          </div>
          <button
            onClick={() => setTabletExpanded(p => !p)}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen size={16} />
          </button>
        </div>

        {/* Icon rail navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-1.5">
          <ul className="space-y-1.5">
            {allNavItems.map(item => (
              <RailItem key={item.to} {...item} />
            ))}
          </ul>
        </nav>

        {/* Profile avatar at the bottom */}
        <div className="flex-shrink-0 border-t border-slate-100 py-3 flex justify-center">
          <NavLink
            to="/profile"
            title={profile.displayName}
            aria-label="View profile"
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-full"
          >
            <UserAvatar src={profile.profilePicSrc} initials={profile.initials} size={8} />
          </NavLink>
        </div>
      </aside>

      {/* ─── TABLET EXPANDED OVERLAY SIDEBAR (768–1023px) ─── */}
      {tabletExpanded && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-2xs transition-opacity duration-200"
            onClick={() => setTabletExpanded(false)}
          />
          <div className="relative flex flex-col w-[260px] h-full bg-white shadow-2xl z-10 border-r border-slate-200 animate-slide-right">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg overflow-hidden bg-blue-600">
                  <img src="/images/luanar7.png" alt="LUANAR" className="w-full h-full object-cover" />
                </div>
                <span className="font-bold text-slate-900 text-sm">StudyHub LUANAR</span>
              </div>
              <button
                onClick={() => setTabletExpanded(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                title="Collapse sidebar"
              >
                <PanelLeftClose size={18} />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3.5 py-4 space-y-6">
              <NavSection label="Study">
                {PRIMARY_NAV.map(item => (
                  <SidebarItem key={item.to} {...item} onClick={() => setTabletExpanded(false)} />
                ))}
              </NavSection>
              <NavSection label="More">
                {SECONDARY_NAV.map(item => (
                  <SidebarItem key={item.to} {...item} onClick={() => setTabletExpanded(false)} />
                ))}
              </NavSection>
              <NavSection label="Account">
                {ACCOUNT_NAV.map(item => (
                  <SidebarItem key={item.to} {...item} onClick={() => setTabletExpanded(false)} />
                ))}
              </NavSection>
            </nav>

            <div className="p-3 border-t border-slate-100 flex-shrink-0">
              <button
                onClick={() => { navigate('/profile'); setTabletExpanded(false); }}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 bg-slate-50 text-left"
              >
                <UserAvatar src={profile.profilePicSrc} initials={profile.initials} size={8} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{profile.displayName}</p>
                  <p className="text-[11px] text-slate-400 truncate">{profile.role}</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MAIN CONTENT VIEWPORT ─── */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto relative">
        <Outlet />

        {/* ─── MOBILE BOTTOM NAV (<768px ONLY) ─── */}
        <BottomNav />
      </div>

    </div>
  );
});

export default AppShell;
