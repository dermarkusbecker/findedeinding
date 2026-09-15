// Started conversations count as half a point; only a finalized week reaches 100%.
export function curriculumWeekProgress(definition, records = [], week, completed = false) {
 if (completed) return 100;
 const steps = definition?.weeks?.[Number(week)-1]?.steps || [];
 if (!steps.length) return 0;
 let earned = 0;
 for (const step of steps) {
  const record = records.find(r => Number(r.week) === Number(week) && r.step_id === step.id);
  if (record?.status === 'completed') earned += 1;
  else if (record?.messages?.some(m => m.role === 'user')) earned += .5;
 }
 return earned ? Math.min(99, Math.max(1, Math.round(earned / steps.length * 100))) : 0;
}
