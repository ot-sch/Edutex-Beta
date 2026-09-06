-- RC6: retain copied template prompts with the actual event proposal and its audit trail.
alter table app.event_plans add column planning_prompts text;
