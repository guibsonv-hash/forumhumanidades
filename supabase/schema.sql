create extension if not exists pgcrypto;

-- Execute este script no SQL Editor do Supabase.

create table if not exists public.forum_registrations (
  id uuid primary key default gen_random_uuid(),
  classroom text not null,
  student_name text not null unique,
  role text not null check (role in ('Assessor', 'Deputado', 'Imprensa', 'Staff')),
  email text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.forum_allowed_roles(p_classroom text)
returns text[]
language sql
immutable
as $$
  select case
    when left(trim(p_classroom), 1) = '1' then array['Assessor', 'Deputado', 'Staff']::text[]
    when left(trim(p_classroom), 1) in ('2', '3') then array['Assessor', 'Deputado', 'Imprensa']::text[]
    else array['Assessor', 'Deputado']::text[]
  end;
$$;

create or replace function public.forum_role_limit(p_role text)
returns int
language sql
immutable
as $$
  select case
    when p_role = 'Staff' then 30
    when p_role = 'Imprensa' then 30
    else null
  end;
$$;

create or replace function public.app_get_status()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with role_limits as (
    select 'Assessor'::text as role, null::int as limit_count
    union all select 'Deputado', null::int
    union all select 'Imprensa', 30
    union all select 'Staff', 30
  ),
  used_by_role as (
    select role, count(*)::int as used_count
    from public.forum_registrations
    group by role
  ),
  vacancies as (
    select jsonb_object_agg(
      r.role,
      case
        when r.limit_count is null then null
        else greatest(r.limit_count - coalesce(u.used_count, 0), 0)
      end
    ) as data
    from role_limits r
    left join used_by_role u on u.role = r.role
  )
  select jsonb_build_object(
    'vacancies', coalesce((select data from vacancies), '{}'::jsonb),
    'registeredStudents', coalesce((select jsonb_agg(student_name order by student_name) from public.forum_registrations), '[]'::jsonb),
    'registeredEmails', coalesce((select jsonb_agg(email order by email) from public.forum_registrations), '[]'::jsonb),
    'registeredEntries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'classroom', classroom,
          'studentName', student_name,
          'email', email,
          'role', role
        )
        order by student_name
      )
      from public.forum_registrations
    ), '[]'::jsonb)
  );
$$;

create or replace function public.app_new_registration(
  p_classroom text,
  p_student_name text,
  p_email text,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_classroom text := trim(coalesce(p_classroom, ''));
  v_student text := trim(coalesce(p_student_name, ''));
  v_email text := trim(coalesce(p_email, ''));
  v_role text := trim(coalesce(p_role, ''));
  v_allowed_roles text[];
  v_used int;
  v_limit int;
  v_remaining int;
begin
  lock table public.forum_registrations in share row exclusive mode;

  if v_classroom = '' or v_student = '' or v_email = '' or v_role = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', 'Preencha turma, nome, e-mail e cargo.', 'status', public.app_get_status());
  end if;

  if v_role not in ('Assessor', 'Deputado', 'Imprensa', 'Staff') then
    return jsonb_build_object('ok', false, 'code', 'ROLE_INVALID', 'message', 'Cargo inválido.', 'status', public.app_get_status());
  end if;

  v_allowed_roles := public.forum_allowed_roles(v_classroom);
  if not (v_role = any(v_allowed_roles)) then
    return jsonb_build_object('ok', false, 'code', 'ROLE_NOT_ALLOWED', 'message', 'Cargo não permitido para a turma selecionada.', 'status', public.app_get_status());
  end if;

  if exists(select 1 from public.forum_registrations where lower(student_name) = lower(v_student)) then
    return jsonb_build_object('ok', false, 'code', 'STUDENT_EXISTS', 'message', 'Aluno já cadastrado.', 'status', public.app_get_status());
  end if;

  if exists(select 1 from public.forum_registrations where lower(email) = lower(v_email)) then
    return jsonb_build_object('ok', false, 'code', 'EMAIL_EXISTS', 'message', 'E-mail já cadastrado.', 'status', public.app_get_status());
  end if;

  select count(*)::int into v_used
  from public.forum_registrations
  where role = v_role;

  v_limit := public.forum_role_limit(v_role);
  if v_limit is not null and v_used >= v_limit then
    return jsonb_build_object('ok', false, 'code', 'NO_VACANCY', 'message', 'Esse cargo não possui vagas.', 'status', public.app_get_status());
  end if;

  insert into public.forum_registrations (classroom, student_name, role, email)
  values (v_classroom, v_student, v_role, v_email);

  v_remaining := case when v_limit is null then null else greatest(v_limit - (v_used + 1), 0) end;

  return jsonb_build_object(
    'ok', true,
    'message', 'Cadastro realizado com sucesso.',
    'remainingForRole', v_remaining,
    'status', public.app_get_status()
  );
end;
$$;

create or replace function public.app_change_registration(
  p_classroom text,
  p_student_name text,
  p_email text,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student text := trim(coalesce(p_student_name, ''));
  v_email text := trim(coalesce(p_email, ''));
  v_new_role text := trim(coalesce(p_role, ''));
  v_current public.forum_registrations%rowtype;
  v_allowed_roles text[];
  v_used int;
  v_limit int;
  v_remaining int;
begin
  lock table public.forum_registrations in share row exclusive mode;

  if v_student = '' or v_email = '' or v_new_role = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', 'Preencha aluno, e-mail e novo cargo.', 'status', public.app_get_status());
  end if;

  select * into v_current
  from public.forum_registrations
  where lower(student_name) = lower(v_student)
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'RECORD_NOT_FOUND', 'message', 'Aluno não encontrado.', 'status', public.app_get_status());
  end if;

  if lower(v_current.email) <> lower(v_email) then
    return jsonb_build_object('ok', false, 'code', 'EMAIL_MISMATCH', 'message', 'E-mail divergente para o aluno informado.', 'status', public.app_get_status());
  end if;

  if v_new_role not in ('Assessor', 'Deputado', 'Imprensa', 'Staff') then
    return jsonb_build_object('ok', false, 'code', 'ROLE_INVALID', 'message', 'Cargo inválido.', 'status', public.app_get_status());
  end if;

  v_allowed_roles := public.forum_allowed_roles(v_current.classroom);
  if not (v_new_role = any(v_allowed_roles)) then
    return jsonb_build_object('ok', false, 'code', 'ROLE_NOT_ALLOWED', 'message', 'Cargo não permitido para a turma do aluno.', 'status', public.app_get_status());
  end if;

  if v_current.role = v_new_role then
    v_limit := public.forum_role_limit(v_new_role);
    if v_limit is null then
      v_remaining := null;
    else
      select greatest(v_limit - count(*)::int, 0) into v_remaining
      from public.forum_registrations
      where role = v_new_role;
    end if;

    return jsonb_build_object('ok', true, 'message', 'Cargo já era o selecionado.', 'remainingForRole', v_remaining, 'status', public.app_get_status());
  end if;

  select count(*)::int into v_used
  from public.forum_registrations
  where role = v_new_role;

  v_limit := public.forum_role_limit(v_new_role);
  if v_limit is not null and v_used >= v_limit then
    return jsonb_build_object('ok', false, 'code', 'NO_VACANCY', 'message', 'Não há vagas para o novo cargo.', 'status', public.app_get_status());
  end if;

  update public.forum_registrations
  set role = v_new_role,
      updated_at = now()
  where id = v_current.id;

  v_remaining := case when v_limit is null then null else greatest(v_limit - (v_used + 1), 0) end;

  return jsonb_build_object(
    'ok', true,
    'message', 'Cadastro alterado com sucesso.',
    'remainingForRole', v_remaining,
    'status', public.app_get_status()
  );
end;
$$;

alter table public.forum_registrations enable row level security;

revoke all on public.forum_registrations from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant execute on function public.app_get_status() to anon, authenticated;
grant execute on function public.app_new_registration(text, text, text, text) to anon, authenticated;
grant execute on function public.app_change_registration(text, text, text, text) to anon, authenticated;
grant execute on function public.forum_allowed_roles(text) to anon, authenticated;
grant execute on function public.forum_role_limit(text) to anon, authenticated;
