/**
 * @fileoverview Implements the protected React portal entry/configuration and is served only after the backend verifies an opaque session.
 *
 * @remarks
 * Direct links: `./components/AppShell.js`, `./core/router.js`, `./core/session.js`, `./pages/AdminPage.js`, `./pages/AttendancePage.js`, `./pages/AuditPage.js`, `./pages/DashboardPage.js`, `./pages/OperationsPage.js`.
 * Security: Browser trust boundary; no database/AWS credentials or protected server decisions may enter this bundle.
 */

import { useState } from 'react';
import { AppearanceProvider } from './core/appearance.js';
import { CommunityPortal } from './pages/CommunityPortal.js';
import { AppShell } from './components/AppShell.js';
import { usePathRouter } from './core/router.js';
import { useSession } from './core/session.js';
import { AdminPage } from './pages/AdminPage.js';
import { AttendancePage } from './pages/AttendancePage.js';
import { AuditPage } from './pages/AuditPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { ImportExportPage, ModuleOverviewPage } from './pages/OperationsPage.js';
import { PhotosPage } from './pages/PhotosPage.js';
import { ResourcePage } from './pages/ResourcePage.js';
import { ModulePage, moduleTabs } from './pages/ModulePage.js';
import { InsightsPage } from './pages/InsightsPage.js';
import { SmartAlertsPage } from './pages/SmartAlertsPage.js';
import { resourcePageConfigurations } from './pages/resource-config.js';

const permissionByRoute: Readonly<Record<ModuleId, string>> = {
  dashboard: 'dashboard:view',
  students: 'students:view',
  attendance: 'attendance:view',
  timetables: 'timetables:view',
  classes: 'classes:view',
  activities: 'activities:view',
  grades: 'grades:view',
  families: 'families:view',
  finance: 'finance:view',
  forms: 'forms:view',
  staff: 'staff:view',
  enrolments: 'enrolments:view',
  communications: 'communications:view',
  events: 'events:view',
  alumni: 'alumni:view',
  photos: 'photos:view',
  'knowledge-base': 'knowledge-base:view',
  'sign-in-out': 'sign-in-out:view',
  'import-export': 'import-export:view',
  audit: 'audit:view',
  admin: 'admin:view',
  management: 'management:view',
  insights: 'insights:view',
  'smart-alerts': 'smart-alerts:view',
  risk: 'risk:view',
  nurse: 'nurse:view',
  wellbeing: 'wellbeing:view',
  maintenance: 'maintenance:view',
  technician: 'technician:view',
  'parent-portal': 'parent-portal:view',
  'student-portal': 'student-portal:view',
};

/** Selects an authorised page without trusting the URL as an access decision. */
function PageRouter(props: {
  readonly path: string;
  readonly navigate: (path: string) => void;
}): React.JSX.Element {
  const { hasPermission, isModuleEnabled, session } = useSession();
  const requestedRoute = props.path.split('/')[0] ?? 'dashboard';
  const route =
    session.user.category === 'parent_guardian'
      ? 'parent-portal'
      : session.user.category === 'student'
        ? 'student-portal'
        : requestedRoute;
  const module = moduleIdSchema.safeParse(route);
  const requiredPermission = module.success ? permissionByRoute[module.data] : undefined;
  if (
    !module.success ||
    !requiredPermission ||
    !hasPermission(requiredPermission) ||
    !isModuleEnabled(module.data)
  ) {
    return (
      <ModuleOverviewPage
        title="Page unavailable"
        description="This page does not exist or your role does not include access."
      />
    );
  }
  if (route === 'parent-portal' || route === 'student-portal') return <CommunityPortal />;
  if (route === 'insights') return <InsightsPage />;
  if (route === 'smart-alerts') return <SmartAlertsPage />;
  if (moduleTabs[route]) return <ModulePage key={route} module={route} />;
  if (route === 'dashboard') return <DashboardPage navigate={props.navigate} />;
  if (route === 'attendance') return <AttendanceWorkspace />;
  if (route === 'admin') return <AdminPage />;
  if (route === 'audit') return <AuditPage />;
  if (route === 'photos') return <PhotosPage />;
  if (route === 'import-export') return <ImportExportPage />;
  if (resourcePageConfigurations[route]) return <ResourcePage route={route} />;
  return (
    <ModuleOverviewPage
      title={route.replaceAll('-', ' ')}
      description="This workflow is available after its reference data is configured."
    />
  );
}

/** Composes the authenticated responsive application shell and route outlet. */
export function App(): React.JSX.Element {
  const router = usePathRouter();
  const { session } = useSession();
  const path =
    session.user.category === 'parent_guardian'
      ? 'parent-portal'
      : session.user.category === 'student'
        ? 'student-portal'
        : router.path;
  return (
    <AppearanceProvider>
      <AppShell currentPath={path} navigate={router.navigate}>
        <PageRouter path={router.path} navigate={router.navigate} />
      </AppShell>
    </AppearanceProvider>
  );
}
import { moduleIdSchema, type ModuleId } from '@edutex/contracts';

/** Adds roll creation and search beside the existing attendance marking workflow. */
function AttendanceWorkspace(): React.JSX.Element {
  const [tab, setTab] = useState('mark');
  return (
    <div>
      <nav className="section-tabs" aria-label="Attendance sections">
        <button
          type="button"
          aria-current={tab === 'mark' ? 'page' : undefined}
          onClick={
            /** Handles App update Tab state from the current control. */
            () => {
              setTab('mark');
            }
          }
        >
          Mark attendance
        </button>
        <button
          type="button"
          aria-current={tab === 'sessions' ? 'page' : undefined}
          onClick={
            /** Handles App update Tab state from the current control. */
            () => {
              setTab('sessions');
            }
          }
        >
          Manage rolls
        </button>
      </nav>
      {tab === 'mark' ? <AttendancePage /> : <ResourcePage route="attendance-sessions" />}
    </div>
  );
}
