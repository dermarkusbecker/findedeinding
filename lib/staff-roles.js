export const STAFF_PERMISSIONS = Object.freeze([
  'dashboard',
  'customers',
  'leads',
  'sales_calls',
  'program',
  'communications',
  'finance',
  'settings',
  'users',
]);

export const STAFF_ROLES = Object.freeze({
  owner: { label: 'Systeminhaber', description: 'Vollzugriff inklusive Rollen, Benutzer und Systemeinstellungen.', permissions: [...STAFF_PERMISSIONS] },
  administrator: { label: 'Administration', description: 'Operative Gesamtverwaltung ohne Änderung der Systeminhaberrolle.', permissions: STAFF_PERMISSIONS.filter((permission) => permission !== 'users') },
  sales: { label: 'Vertrieb', description: 'Interessenten, Verkaufs- und Kundengespräche sowie Kommunikation.', permissions: ['dashboard', 'leads', 'sales_calls', 'communications'] },
  customer_success: { label: 'Kundenbetreuung', description: 'Kundenakten, Gespräche und Steuerung des Acht-Wochen-Prozesses.', permissions: ['dashboard', 'customers', 'sales_calls', 'program', 'communications'] },
  communications: { label: 'Kommunikation', description: 'Postfach, Vorlagen, Seriennachrichten und Automationen.', permissions: ['dashboard', 'customers', 'leads', 'communications'] },
  finance: { label: 'Finanzen', description: 'Kunden, Verträge, Kontostände und Zahlungsabgleich.', permissions: ['dashboard', 'customers', 'finance'] },
});

export function staffPermissionsFor(role) {
  return [...(STAFF_ROLES[role]?.permissions || [])];
}

export function validStaffRole(role) {
  return Object.hasOwn(STAFF_ROLES, role);
}
