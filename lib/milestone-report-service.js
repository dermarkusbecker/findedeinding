import { milestoneSources, generateMilestoneReport } from './milestone-report-agent.js';
import { serviceHeaders } from './program-access-service.js';

export async function readMilestoneReports({ service, participantId }) {
  const response = await fetch(`${service.url}/rest/v1/milestone_reports?user_profile_id=eq.${encodeURIComponent(participantId)}&select=milestone_week,report,generated_at,process_version&order=milestone_week.asc`, { headers: serviceHeaders(service.key) });
  const rows = await response.json();
  if (!response.ok) throw new Error(rows.message || 'Berichte konnten nicht geladen werden.');
  return rows;
}

export async function ensureMilestoneReports({ result, participantId, weekOneState, guidedStates, generate = generateMilestoneReport }) {
  const existing = await readMilestoneReports({ service: result.service, participantId });
  const processVersion = Number(result.processVersion?.version || 0);
  const completed = new Set((result.serializedAccess.completedWeeks || []).map(Number));
  const reports = existing.filter((row) => row.process_version === processVersion);
  for (const milestoneWeek of [4, 8]) {
    if (!Array.from({ length: milestoneWeek }, (_, index) => index + 1).every((week) => completed.has(week))) continue;
    if (reports.some((row) => row.milestone_week === milestoneWeek)) continue;
    const sources = milestoneSources({ milestoneWeek, definition: result.processVersion?.definition, curriculum: result.curriculum, weekOneState, guidedStates });
    const report = await generate({ participantId, participantName: result.profile.name, milestoneWeek, sources });
    const response = await fetch(`${result.service.url}/rest/v1/milestone_reports?on_conflict=user_profile_id,milestone_week,process_version`, {
      method: 'POST',
      headers: serviceHeaders(result.service.key, { Prefer: 'resolution=ignore-duplicates,return=representation' }),
      body: JSON.stringify({ user_profile_id: participantId, milestone_week: milestoneWeek, process_version: processVersion, report, generator: report.generator, model: report.model, version: report.version }),
    });
    const rows = await response.json();
    if (!response.ok) throw new Error(rows.message || 'Bericht konnte nicht gespeichert werden.');
    if (rows[0]) reports.push(rows[0]);
    else {
      const current = await readMilestoneReports({ service: result.service, participantId });
      const row = current.find((item) => item.process_version === processVersion && item.milestone_week === milestoneWeek);
      if (row) reports.push(row);
    }
  }
  return reports.sort((left, right) => left.milestone_week - right.milestone_week).map((row) => ({ milestoneWeek: row.milestone_week, generatedAt: row.generated_at, ...row.report }));
}
