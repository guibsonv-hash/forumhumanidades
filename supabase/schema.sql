create extension if not exists pgcrypto;

create table if not exists public.forum_registrations (
  id uuid primary key default gen_random_uuid(),
  classroom text not null,
  student_name text not null unique,
  role text not null check (role in ('Assessor', 'Deputado', 'Imprensa', 'Staff')),
  email text not null unique,
  pair_group_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.forum_registrations add column if not exists pair_group_id uuid;

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

create or replace function public.forum_counterpart_role(p_role text)
returns text
language sql
immutable
as $$
  select case
    when p_role = 'Assessor' then 'Deputado'
    when p_role = 'Deputado' then 'Assessor'
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
      case when r.limit_count is null then null else greatest(r.limit_count - coalesce(u.used_count, 0), 0) end
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
          'role', role,
          'pairGroupId', pair_group_id
        ) order by student_name
      )
      from public.forum_registrations
    ), '[]'::jsonb)
  );
$$;

create or replace function public.app_new_registration(
  p_classroom text,
  p_student_name text,
  p_email text,
  p_role text,
  p_partner_classroom text default null,
  p_partner_student_name text default null,
  p_partner_email text default null
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

  v_partner_classroom text := trim(coalesce(p_partner_classroom, ''));
  v_partner_student text := trim(coalesce(p_partner_student_name, ''));
  v_partner_email text := trim(coalesce(p_partner_email, ''));
  v_partner_role text;

  v_allowed_roles text[];
  v_allowed_partner_roles text[];
  v_limit int;
  v_partner_limit int;
  v_used int;
  v_partner_used int;
  v_remaining int;
  v_pair_id uuid;
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

  if v_role in ('Assessor', 'Deputado') then
    if v_partner_classroom = '' or v_partner_student = '' or v_partner_email = '' then
      return jsonb_build_object('ok', false, 'code', 'PARTNER_REQUIRED', 'message', 'Assessor e Deputado exigem cadastro de parceiro.', 'status', public.app_get_status());
    end if;

    if lower(v_partner_student) = lower(v_student) or lower(v_partner_email) = lower(v_email) then
      return jsonb_build_object('ok', false, 'code', 'PARTNER_SAME_STUDENT', 'message', 'Parceiro deve ser um aluno diferente.', 'status', public.app_get_status());
    end if;

    if exists(select 1 from public.forum_registrations where lower(student_name) = lower(v_partner_student)) then
      return jsonb_build_object('ok', false, 'code', 'PARTNER_STUDENT_EXISTS', 'message', 'Nome do parceiro já cadastrado.', 'status', public.app_get_status());
    end if;

    if exists(select 1 from public.forum_registrations where lower(email) = lower(v_partner_email)) then
      return jsonb_build_object('ok', false, 'code', 'PARTNER_EMAIL_EXISTS', 'message', 'E-mail do parceiro já cadastrado.', 'status', public.app_get_status());
    end if;

    v_partner_role := public.forum_counterpart_role(v_role);
    v_allowed_partner_roles := public.forum_allowed_roles(v_partner_classroom);

    if not (v_partner_role = any(v_allowed_partner_roles)) then
      return jsonb_build_object('ok', false, 'code', 'PARTNER_ROLE_NOT_ALLOWED', 'message', 'Cargo do parceiro não permitido para a turma informada.', 'status', public.app_get_status());
    end if;
  end if;

  v_limit := public.forum_role_limit(v_role);
  select count(*)::int into v_used from public.forum_registrations where role = v_role;
  if v_limit is not null and v_used >= v_limit then
    return jsonb_build_object('ok', false, 'code', 'NO_VACANCY', 'message', 'Esse cargo não possui vagas.', 'status', public.app_get_status());
  end if;

  if v_role in ('Assessor', 'Deputado') then
    v_partner_limit := public.forum_role_limit(v_partner_role);
    select count(*)::int into v_partner_used from public.forum_registrations where role = v_partner_role;
    if v_partner_limit is not null and v_partner_used >= v_partner_limit then
      return jsonb_build_object('ok', false, 'code', 'NO_VACANCY', 'message', 'Cargo do parceiro sem vagas disponíveis.', 'status', public.app_get_status());
    end if;
  end if;

  if v_role in ('Assessor', 'Deputado') then
    v_pair_id := gen_random_uuid();
  else
    v_pair_id := null;
  end if;

  insert into public.forum_registrations (classroom, student_name, role, email, pair_group_id)
  values (v_classroom, v_student, v_role, v_email, v_pair_id);

  if v_role in ('Assessor', 'Deputado') then
    insert into public.forum_registrations (classroom, student_name, role, email, pair_group_id)
    values (v_partner_classroom, v_partner_student, v_partner_role, v_partner_email, v_pair_id);
  end if;

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
  p_role text,
  p_partner_classroom text default null,
  p_partner_student_name text default null,
  p_partner_email text default null
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

  v_partner_classroom text := trim(coalesce(p_partner_classroom, ''));
  v_partner_student text := trim(coalesce(p_partner_student_name, ''));
  v_partner_email text := trim(coalesce(p_partner_email, ''));
  v_partner_role text;

  v_current public.forum_registrations%rowtype;
  v_partner public.forum_registrations%rowtype;
  v_partner_exists boolean := false;

  v_allowed_roles text[];
  v_allowed_partner_roles text[];

  v_limit int;
  v_partner_limit int;
  v_used int;
  v_partner_used int;
  v_remaining int;

  v_old_pair uuid;
  v_partner_old_pair uuid;
  v_new_pair uuid;
begin
  lock table public.forum_registrations in share row exclusive mode;

  if v_student = '' or v_email = '' or v_new_role = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', 'Preencha aluno, e-mail e novo cargo.', 'status', public.app_get_status());
  end if;

  select * into v_current from public.forum_registrations where lower(student_name) = lower(v_student) limit 1;
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

  v_old_pair := v_current.pair_group_id;

  v_limit := public.forum_role_limit(v_new_role);
  select count(*)::int into v_used from public.forum_registrations where role = v_new_role;
  if v_limit is not null and v_current.role <> v_new_role and v_used >= v_limit then
    return jsonb_build_object('ok', false, 'code', 'NO_VACANCY', 'message', 'Não há vagas para o novo cargo.', 'status', public.app_get_status());
  end if;

  if v_new_role in ('Assessor', 'Deputado') then
    if v_partner_classroom = '' or v_partner_student = '' or v_partner_email = '' then
      return jsonb_build_object('ok', false, 'code', 'PARTNER_REQUIRED', 'message', 'Assessor e Deputado exigem cadastro de parceiro.', 'status', public.app_get_status());
    end if;

    if lower(v_partner_student) = lower(v_current.student_name) or lower(v_partner_email) = lower(v_current.email) then
      return jsonb_build_object('ok', false, 'code', 'PARTNER_SAME_STUDENT', 'message', 'Parceiro deve ser um aluno diferente.', 'status', public.app_get_status());
    end if;

    v_partner_role := public.forum_counterpart_role(v_new_role);
    v_allowed_partner_roles := public.forum_allowed_roles(v_partner_classroom);

    if not (v_partner_role = any(v_allowed_partner_roles)) then
      return jsonb_build_object('ok', false, 'code', 'PARTNER_ROLE_NOT_ALLOWED', 'message', 'Cargo do parceiro não permitido para a turma informada.', 'status', public.app_get_status());
    end if;

    select * into v_partner from public.forum_registrations where lower(student_name) = lower(v_partner_student) limit 1;
    v_partner_exists := found;

    if v_partner_exists then
      if v_partner.id = v_current.id then
        return jsonb_build_object('ok', false, 'code', 'PARTNER_SAME_STUDENT', 'message', 'Parceiro deve ser um aluno diferente.', 'status', public.app_get_status());
      end if;

      if v_current.pair_group_id is null
         or v_partner.pair_group_id is null
         or v_partner.pair_group_id <> v_current.pair_group_id then
        return jsonb_build_object('ok', false, 'code', 'PARTNER_STUDENT_EXISTS', 'message', 'Nome do parceiro ja cadastrado para outro cadastro.', 'status', public.app_get_status());
      end if;

      if lower(v_partner.email) <> lower(v_partner_email) then
        return jsonb_build_object('ok', false, 'code', 'PARTNER_EMAIL_MISMATCH', 'message', 'E-mail do parceiro divergente para o nome informado.', 'status', public.app_get_status());
      end if;

      if exists(select 1 from public.forum_registrations where lower(email) = lower(v_partner_email) and id <> v_partner.id) then
        return jsonb_build_object('ok', false, 'code', 'PARTNER_EMAIL_EXISTS', 'message', 'E-mail do parceiro já está associado a outro cadastro.', 'status', public.app_get_status());
      end if;

      v_partner_old_pair := v_partner.pair_group_id;
    else
      if exists(select 1 from public.forum_registrations where lower(email) = lower(v_partner_email)) then
        return jsonb_build_object('ok', false, 'code', 'PARTNER_EMAIL_EXISTS', 'message', 'E-mail do parceiro já cadastrado.', 'status', public.app_get_status());
      end if;

      v_partner_old_pair := null;
    end if;

    v_partner_limit := public.forum_role_limit(v_partner_role);
    select count(*)::int into v_partner_used from public.forum_registrations where role = v_partner_role;

    if v_partner_limit is not null then
      if v_partner_exists and v_partner.role = v_partner_role then
        null;
      elsif v_partner_used >= v_partner_limit then
        return jsonb_build_object('ok', false, 'code', 'NO_VACANCY', 'message', 'Cargo do parceiro sem vagas disponíveis.', 'status', public.app_get_status());
      end if;
    end if;

    v_new_pair := gen_random_uuid();

    update public.forum_registrations
    set role = v_new_role,
        pair_group_id = v_new_pair,
        updated_at = now()
    where id = v_current.id;

    if v_partner_exists then
      update public.forum_registrations
      set classroom = v_partner_classroom,
          role = v_partner_role,
          email = v_partner_email,
          pair_group_id = v_new_pair,
          updated_at = now()
      where id = v_partner.id;
    else
      insert into public.forum_registrations (classroom, student_name, role, email, pair_group_id)
      values (v_partner_classroom, v_partner_student, v_partner_role, v_partner_email, v_new_pair);
    end if;

    if v_old_pair is not null then
      update public.forum_registrations
      set pair_group_id = null,
          updated_at = now()
      where pair_group_id = v_old_pair
        and id <> v_current.id
        and (not v_partner_exists or id <> v_partner.id);
    end if;

    if v_partner_old_pair is not null and v_partner_old_pair <> v_old_pair then
      update public.forum_registrations
      set pair_group_id = null,
          updated_at = now()
      where pair_group_id = v_partner_old_pair
        and id <> v_current.id
        and (not v_partner_exists or id <> v_partner.id);
    end if;
  else
    update public.forum_registrations
    set role = v_new_role,
        pair_group_id = null,
        updated_at = now()
    where id = v_current.id;

    if v_old_pair is not null then
      update public.forum_registrations
      set pair_group_id = null,
          updated_at = now()
      where pair_group_id = v_old_pair
        and id <> v_current.id;
    end if;
  end if;

  v_remaining := case when v_limit is null then null else greatest(v_limit - (case when v_current.role = v_new_role then v_used else (v_used + 1) end), 0) end;

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
grant execute on function public.app_new_registration(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.app_change_registration(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.forum_allowed_roles(text) to anon, authenticated;
grant execute on function public.forum_role_limit(text) to anon, authenticated;
grant execute on function public.forum_counterpart_role(text) to anon, authenticated;

