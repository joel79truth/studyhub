// src/config/navigation.js
// Single source of truth for navigation across StudyHub
// Shared by BottomNav (mobile) and AppShell (tablet & desktop sidebar)

import {
  Home,
  FileText,
  BookOpen,
  Brain,
  Calendar,
  HelpCircle,
  User,
  Settings,
} from 'lucide-react';

// Core 4 items shown on mobile BottomNav and the top group of DesktopSidebar
export const PRIMARY_NAV = [
  { to: '/',         label: 'Home',        icon: Home,       end: true },
  { to: '/papers',   label: 'Past Papers', icon: FileText,   end: false },
  { to: '/programs', label: 'Notes',       icon: BookOpen,   end: false },
  { to: '/quiz',     label: 'Quiz',        icon: Brain,      end: false },
];

// Secondary items from the mobile drawer
export const SECONDARY_NAV = [
  { to: '/tutorials', label: 'Tutorials',     icon: BookOpen,   end: false },
  { to: '/timetable', label: 'Timetable',     icon: Calendar,   end: false },
  { to: '/request',   label: 'Request Notes', icon: HelpCircle, end: false },
];

// Account items from the mobile drawer
export const ACCOUNT_NAV = [
  { to: '/profile',  label: 'Profile',             icon: User,     end: false },
  { to: '/settings', label: 'Settings & Updates',  icon: Settings, end: false },
];

export const ALL_NAV_ITEMS = [...PRIMARY_NAV, ...SECONDARY_NAV, ...ACCOUNT_NAV];
