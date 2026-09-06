/** @fileoverview Related workflow tabs extend existing modules without removing RC5 record access. */
import { EventConsent } from './EventConsent.js';
import { MedicalWorkspace } from './MedicalWorkspace.js';
import { useState } from 'react';
import { ResourcePage } from './ResourcePage.js';
import { FinanceReports } from './FinanceReports.js';
export const moduleTabs: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  timetables: [
    ['timetables', 'Timetables'],
    ['bell-periods', 'Sessions'],
    ['timetable-entries', 'Scheduled classes'],
  ],
  grades: [
    ['grades', 'Assessments'],
    ['grade-results', 'Results & feedback'],
  ],
  management: [
    ['campuses', 'Campuses'],
    ['academic-years', 'Academic years'],
    ['terms', 'Term dates'],
    ['bell-periods', 'Sessions'],
    ['important-dates', 'Important dates'],
    ['school-groups', 'Groups'],
    ['group-members', 'Members'],
    ['departments', 'Departments'],
    ['portal-contacts', 'Portal contacts'],
  ],
  events: [
    ['events', 'Events'],
    ['event-participants', 'Participants'],
    ['event-consent', 'Consent & paper forms'],
    ['event-plans', 'Proposals & plans'],
    ['event-risks', 'Risk assessments'],
    ['venues', 'Venues'],
    ['event-templates', 'Templates'],
    ['event-access', 'Access schedules'],
    ['medical-records', 'Medical records'],
  ],
  finance: [
    ['finance', 'Customer invoices'],
    ['invoice-allocations', 'Guardian fee responsibility'],
    ['payments', 'Receipts'],
    ['purchase-orders', 'Purchase orders'],
    ['supplier-bills', 'Accounts payable'],
    ['suppliers', 'Suppliers'],
    ['budgets', 'Budgets'],
    ['fee-policies', 'Discounts & fee splits'],
    ['bank-accounts', 'Bank accounts'],
    ['bank-transactions', 'Reconciliation'],
    ['payroll-lines', 'Payroll'],
    ['report-templates', 'Templates'],
    ['reports', 'Reports'],
  ],
  risk: [
    ['risk-incidents', 'Incidents'],
    ['hazards', 'Hazards'],
    ['safety-drills', 'Fire & emergency'],
    ['approval-streams', 'Approval streams'],
  ],
  nurse: [
    ['nurse-visits', 'Nurse visits'],
    ['medical-records', 'Medical records'],
  ],
  wellbeing: [['wellbeing-cases', 'Wellbeing cases']],
  maintenance: [
    ['work-orders', 'Work orders'],
    ['buildings', 'Buildings'],
    ['rooms', 'Rooms'],
    ['maintenance-history', 'History'],
  ],
  alumni: [
    ['alumni', 'Profiles'],
    ['alumni-donations', 'Donations'],
    ['alumni-events', 'Events'],
    ['alumni-family-links', 'Family links'],
  ],
  staff: [
    ['staff', 'Staff directory'],
    ['staff-onboarding', 'Onboarding & training'],
  ],
  classes: [
    ['classes', 'Classes'],
    ['class-rosters', 'Student rosters'],
    ['class-teachers', 'Teachers'],
    ['course-materials', 'Course materials'],
    ['assignments', 'Assignments'],
  ],
  families: [
    ['families', 'Families'],
    ['guardians', 'Guardians'],
    ['family-students', 'Students'],
    ['guardian-relationships', 'Relationships & contact permissions'],
  ],
};
/** Groups related actions into scrollable tabs that remain usable on narrow devices. */
export function ModulePage({ module }: { readonly module: string }): React.JSX.Element {
  const tabs = moduleTabs[module] ?? [];
  const [selected, setSelected] = useState(tabs[0]?.[0] ?? module);
  return (
    <div>
      <nav className="section-tabs" aria-label={module + ' sections'}>
        {tabs.map(
          /** Renders tabs entries with their stable identifiers and visible labels. */
          ([route, label]) => (
            <button
              type="button"
              key={route}
              aria-current={selected === route ? 'page' : undefined}
              onClick={
                /** Handles Module Page update Selected state from the current control. */
                () => {
                  setSelected(route);
                }
              }
            >
              {label}
            </button>
          ),
        )}
      </nav>
      {selected === 'event-consent' ? (
        <EventConsent />
      ) : selected === 'medical-records' ? (
        <MedicalWorkspace />
      ) : selected === 'reports' ? (
        <FinanceReports />
      ) : (
        <ResourcePage route={selected} />
      )}
    </div>
  );
}
