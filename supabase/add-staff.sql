-- Give people access. Run in SQL Editor AFTER you have created their login under
-- Authentication > Users > Add user (tick "Auto Confirm User").
-- Replace the email address and name, then run only the lines you need.

-- The club admin (can also delete records):
insert into public.staff (user_id, role, display_name)
select id, 'admin', 'Grace' from auth.users where email = 'REPLACE-WITH-YOUR-EMAIL'
on conflict (user_id) do update set role = excluded.role, display_name = excluded.display_name;

-- A volunteer (can add, view and edit records, but not delete):
insert into public.staff (user_id, role, display_name)
select id, 'volunteer', 'REPLACE-WITH-VOLUNTEER-NAME' from auth.users where email = 'REPLACE-WITH-VOLUNTEER-EMAIL'
on conflict (user_id) do update set role = excluded.role, display_name = excluded.display_name;

-- Take access away from someone:
-- delete from public.staff where user_id = (select id from auth.users where email = 'THEIR-EMAIL');
