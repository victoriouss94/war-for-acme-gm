create index if not exists role_assignment_previews_created_by_idx
  on public.role_assignment_previews(created_by);

create index if not exists role_assignment_history_preview_id_idx
  on public.role_assignment_history(preview_id);

create index if not exists role_assignment_history_assigned_by_idx
  on public.role_assignment_history(assigned_by);
