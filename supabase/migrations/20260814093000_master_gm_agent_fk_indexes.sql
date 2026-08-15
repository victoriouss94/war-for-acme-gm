-- Cover Master GM foreign keys used by audit and reviewer lookups.
create index ai_agent_runs_created_by_idx on public.ai_agent_runs(created_by);
create index ai_change_proposals_run_idx on public.ai_change_proposals(run_id);
create index ai_change_proposals_created_by_idx on public.ai_change_proposals(created_by);
create index ai_change_proposals_reviewed_by_idx on public.ai_change_proposals(reviewed_by) where reviewed_by is not null;
