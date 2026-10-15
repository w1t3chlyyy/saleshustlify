-- Only assign businesses fetched from the 2GIS Places API.
-- Keep the stale-assignment reuse behavior from migration 002.
create or replace function claim_businesses(p_user uuid, p_city text, p_day date, p_n int)
returns setof assignments language plpgsql security definer as $$
begin
  return query
  with pick as (
    select b.id, stale.id as stale_assignment_id
    from businesses b
    left join lateral (
      select a.id
      from assignments a
      where a.business_id = b.id
        and a.user_id = p_user
        and a.status = 'assigned'
        and a.day < p_day
      order by a.day desc, a.id desc
      limit 1
    ) stale on true
    where b.city_key = lower(trim(p_city))
      and b.source = '2gis'
      and not exists (
        select 1 from assignments a
        where a.business_id = b.id
          and (
            (a.user_id = p_user and (a.status <> 'assigned' or a.day >= p_day))
            or (a.user_id <> p_user
                and (a.status in ('in_work','submitted','approved')
                     or (a.status = 'assigned' and a.day >= p_day)))
          )
      )
    order by random()
    limit greatest(coalesce(p_n, 0), 0)
    for update of b skip locked
  ),
  reused as (
    update assignments a
    set day = p_day,
        status = 'assigned',
        proof_text = null,
        proof_path = null,
        reviewer_note = null,
        coins_awarded = 0,
        taken_at = null,
        submitted_at = null,
        reviewed_at = null
    from pick
    where a.id = pick.stale_assignment_id
    returning a.*
  ),
  inserted as (
    insert into assignments(user_id, business_id, day)
    select p_user, pick.id, p_day
    from pick
    where pick.stale_assignment_id is null
    returning *
  )
  select * from reused
  union all
  select * from inserted;
end $$;
