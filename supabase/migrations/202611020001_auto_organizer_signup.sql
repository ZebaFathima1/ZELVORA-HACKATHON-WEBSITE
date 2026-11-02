create or replace function public.handle_new_organizer_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null then
    insert into public.admin_users (user_uuid, email, role)
    values (new.id, new.email, 'organizer')
    on conflict (user_uuid) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_add_organizer on auth.users;

create trigger on_auth_user_created_add_organizer
after insert on auth.users
for each row execute function public.handle_new_organizer_user();

insert into public.admin_users (user_uuid, email, role)
select id, email, 'organizer'
from auth.users
where email is not null
on conflict (user_uuid) do nothing;
