/**
 * @fileoverview Implements the reusable protected-portal navigation component used by one or more authenticated pages.
 *
 * @remarks
 * Direct links: `@edutex/contracts`, `lucide-react`, `lucide-react`, `../core/session.js`, `/app/edutex-logo.png`.
 * Security: Browser trust boundary; no database/AWS credentials or protected server decisions may enter this bundle.
 */

import type { ModuleId } from '@edutex/contracts';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BadgeDollarSign,
  BookOpenCheck,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardCheck,
  Clock3,
  Database,
  FileCheck2,
  FileStack,
  GraduationCap,
  Images,
  LayoutDashboard,
  Megaphone,
  Network,
  Settings2,
  ShieldCheck,
  Sparkles,
  TableProperties,
  UserRoundCheck,
  UsersRound,
  X,
} from 'lucide-react';

import { useSession } from '../core/session.js';

export interface NavigationItem {
  readonly path: ModuleId;
  readonly label: string;
  readonly permission: string;
  readonly icon: LucideIcon;
  readonly group: 'workspace' | 'school' | 'operations' | 'system';
}

export const navigationItems: readonly NavigationItem[] = [
  {
    path: 'dashboard',
    label: 'Dashboard',
    permission: 'dashboard:view',
    icon: LayoutDashboard,
    group: 'workspace',
  },
  {
    path: 'students',
    label: 'Students',
    permission: 'students:view',
    icon: GraduationCap,
    group: 'school',
  },
  {
    path: 'attendance',
    label: 'Attendance',
    permission: 'attendance:view',
    icon: ClipboardCheck,
    group: 'school',
  },
  {
    path: 'timetables',
    label: 'Timetables',
    permission: 'timetables:view',
    icon: Clock3,
    group: 'school',
  },
  {
    path: 'classes',
    label: 'Classes',
    permission: 'classes:view',
    icon: BookOpenCheck,
    group: 'school',
  },
  {
    path: 'activities',
    label: 'Activities',
    permission: 'activities:view',
    icon: Sparkles,
    group: 'school',
  },
  {
    path: 'grades',
    label: 'Grades',
    permission: 'grades:view',
    icon: ChartNoAxesCombined,
    group: 'school',
  },
  {
    path: 'families',
    label: 'Families',
    permission: 'families:view',
    icon: UsersRound,
    group: 'operations',
  },
  {
    path: 'staff',
    label: 'Staff',
    permission: 'staff:view',
    icon: UserRoundCheck,
    group: 'operations',
  },
  {
    path: 'enrolments',
    label: 'Enrolments',
    permission: 'enrolments:view',
    icon: FileCheck2,
    group: 'operations',
  },
  {
    path: 'finance',
    label: 'Finance',
    permission: 'finance:view',
    icon: BadgeDollarSign,
    group: 'operations',
  },
  { path: 'forms', label: 'Forms', permission: 'forms:view', icon: FileStack, group: 'operations' },
  {
    path: 'communications',
    label: 'Communications',
    permission: 'communications:view',
    icon: Megaphone,
    group: 'operations',
  },
  {
    path: 'events',
    label: 'Events',
    permission: 'events:view',
    icon: CalendarDays,
    group: 'operations',
  },
  {
    path: 'alumni',
    label: 'Alumni',
    permission: 'alumni:view',
    icon: Building2,
    group: 'operations',
  },
  { path: 'photos', label: 'Photos', permission: 'photos:view', icon: Images, group: 'operations' },
  {
    path: 'knowledge-base',
    label: 'Knowledge base',
    permission: 'knowledge-base:view',
    icon: TableProperties,
    group: 'operations',
  },
  {
    path: 'sign-in-out',
    label: 'Sign in / out',
    permission: 'sign-in-out:view',
    icon: Network,
    group: 'operations',
  },
  {
    path: 'import-export',
    label: 'Import & export',
    permission: 'import-export:view',
    icon: Database,
    group: 'system',
  },
  { path: 'audit', label: 'Audit', permission: 'audit:view', icon: ShieldCheck, group: 'system' },
  {
    path: 'admin',
    label: 'Administration',
    permission: 'admin:view',
    icon: Settings2,
    group: 'system',
  },
  {
    path: 'management',
    label: 'School management',
    permission: 'management:view',
    icon: Settings2,
    group: 'system',
  },
  {
    path: 'insights',
    label: 'Insights',
    permission: 'insights:view',
    icon: ChartNoAxesCombined,
    group: 'workspace',
  },
  {
    path: 'smart-alerts',
    label: 'Smart alerts',
    permission: 'smart-alerts:view',
    icon: Sparkles,
    group: 'workspace',
  },
  {
    path: 'risk',
    label: 'Risk & compliance',
    permission: 'risk:view',
    icon: ShieldCheck,
    group: 'operations',
  },
  { path: 'nurse', label: 'Nurse', permission: 'nurse:view', icon: Activity, group: 'school' },
  {
    path: 'wellbeing',
    label: 'Wellbeing',
    permission: 'wellbeing:view',
    icon: UsersRound,
    group: 'school',
  },
  {
    path: 'maintenance',
    label: 'Facilities & maintenance',
    permission: 'maintenance:view',
    icon: Building2,
    group: 'operations',
  },
  {
    path: 'parent-portal',
    label: 'Parent portal',
    permission: 'parent-portal:view',
    icon: UsersRound,
    group: 'workspace',
  },
  {
    path: 'student-portal',
    label: 'Student portal',
    permission: 'student-portal:view',
    icon: GraduationCap,
    group: 'workspace',
  },
  {
    path: 'technician',
    label: 'Technician portal',
    permission: 'technician:view',
    icon: Database,
    group: 'system',
  },
] as const;

const groups = [
  ['workspace', 'Workspace'],
  ['school', 'Learning & wellbeing'],
  ['operations', 'School operations'],
  ['system', 'Governance'],
] as const;

/** Renders permission-aware navigation shared by desktop and mobile shells. */
export function Navigation(props: {
  readonly currentPath: string;
  readonly onNavigate: (path: string) => void;
  readonly onClose?: () => void;
}): React.JSX.Element {
  const { session, hasPermission, isModuleEnabled } = useSession();
  const availableItems = navigationItems.filter(
    /** Keeps only input items that satisfy this predicate before `Navigation` continues its lookup, render or request construction. It receives `item`. Direct links: `hasPermission`, `isModuleEnabled`. */ (
      item,
    ) =>
      hasPermission(item.permission) &&
      isModuleEnabled(item.path) &&
      (session.user.category === 'parent_guardian'
        ? item.path === 'parent-portal'
        : session.user.category === 'student'
          ? item.path === 'student-portal'
          : !['parent-portal', 'student-portal'].includes(item.path)),
  );
  return (
    <div className="flex h-full flex-col">
      <div className="sidebar-brand">
        <img src="/app/edutex-logo.png" alt="Edutex" className="h-8 w-auto" />
        {props.onClose ? (
          <button
            className="icon-button lg:hidden"
            type="button"
            onClick={props.onClose}
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        ) : null}
      </div>
      <nav className="sidebar-scroll" aria-label="Main navigation">
        {groups.map(
          /** Transforms each input item for `Navigation` into the derived value or React element consumed by the surrounding collection. It receives `[group, title]`. Direct links: `availableItems.filter`, `items.map`. */ ([
            group,
            title,
          ]) => {
            const items = availableItems.filter(
              /** Keeps only input items that satisfy this predicate before `Navigation` continues its lookup, render or request construction. It receives `item`. It uses only the local values shown in its body. */ (
                item,
              ) => item.group === group,
            );
            if (items.length === 0) return null;
            return (
              <div className="nav-group" key={group}>
                <p className="nav-group-label">{title}</p>
                {items.map(
                  /** Transforms each input item for `Navigation` into the derived value or React element consumed by the surrounding collection. It receives `item`. Direct links: `props.currentPath.split`. */ (
                    item,
                  ) => {
                    const Icon = item.icon;
                    const active = props.currentPath.split('/')[0] === item.path;
                    return (
                      <button
                        key={item.path}
                        className={active ? 'nav-item nav-item-active' : 'nav-item'}
                        onClick={
                          /** Handles the React `onClick` event inside `Navigation`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `props.onNavigate`, `props.onClose`. */ () => {
                            if (item.path === 'technician') window.location.assign('/technician/');
                            else props.onNavigate(item.path);
                            props.onClose?.();
                          }
                        }
                        type="button"
                        aria-current={active ? 'page' : undefined}
                      >
                        <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                        <span>{item.label}</span>
                      </button>
                    );
                  },
                )}
              </div>
            );
          },
        )}
      </nav>
      <div className="sidebar-footer">
        <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
          <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]" />
          Protected connection
        </div>
      </div>
    </div>
  );
}

/** Returns a human-readable title and icon for a route. */
export function routeMetadata(path: string): { readonly label: string; readonly icon: LucideIcon } {
  const first = path.split('/')[0] ?? 'dashboard';
  const found = navigationItems.find(
    /** Selects the first input item matching this lookup condition for `routeMetadata`; no match deliberately returns undefined. It receives `item`. It uses only the local values shown in its body. */ (
      item,
    ) => item.path === first,
  );
  return found ?? { label: 'Workspace', icon: Activity };
}
