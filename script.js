const APP_PASSWORD = "univ@p.humanidades";
const PROFESSOR_SECRET_CODES = Object.freeze([97, 47, 104, 74, 52, 112, 110, 126, 47, 41, 68, 36, 110, 93, 127, 52, 99, 77, 53, 102, 110]);
const PROFESSOR_SECRET_MASK = Object.freeze([17, 93, 7, 44, 81, 3, 29]);
const REGISTRATION_OPEN_AT_UTC_MS = Date.parse("2026-03-19T13:00:00Z");
const REGISTRATION_LOCK_MESSAGE =
  "Aguarde mais um pouco: as inscri\u00e7\u00f5es abrem em 19/03/2026 \u00e0s 10h00 (Bras\u00edlia).";

const ROLE_ORDER = ["Assessor", "Deputado", "Imprensa", "Staff"];
const UNLIMITED_ROLES = new Set(["Assessor", "Deputado"]);
const PAIRED_ROLES = new Set(["Assessor", "Deputado"]);
const LIMITED_ROLE_MAX = Object.freeze({
  Staff: 30,
  Imprensa: 30,
  Assessor: null,
  Deputado: null,
});
const COMMISSION_OPTIONS = Object.freeze([
  "Saúde",
  "Educação",
  "Direitos Humanos",
  "Indústria, ciência e tecnologia",
  "Meio ambiente e sustentabilidade",
  "Segurança Pública",
]);
const COMMISSION_CANONICAL = Object.freeze({
  "saude": "Saúde",
  "educacao": "Educação",
  "direitos humanos": "Direitos Humanos",
  "industria, ciencia e tecnologia": "Indústria, ciência e tecnologia",
  "meio ambiente e sustentabilidade": "Meio ambiente e sustentabilidade",
  "seguranca publica": "Segurança Pública",
});


const accessScreen = document.getElementById("access-screen");
const studentScreen = document.getElementById("student-screen");
const changeScreen = document.getElementById("change-screen");
const roleScreen = document.getElementById("role-screen");
const partnerScreen = document.getElementById("partner-screen");

const accessForm = document.getElementById("access-form");
const accessPasswordInput = document.getElementById("student-password");
const accessError = document.getElementById("access-error");
const accessLoading = document.getElementById("access-loading");
const newRegistrationButton = document.getElementById("new-registration-btn");
const changeRegistrationButton = document.getElementById("change-registration-btn");
const registrationCountdown = document.getElementById("registration-countdown");
const registrationCountdownValue = document.getElementById("registration-countdown-value");
const registrationCountdownTarget = document.getElementById("registration-countdown-target");
const countdownDays = document.getElementById("countdown-days");
const countdownHours = document.getElementById("countdown-hours");
const countdownMinutes = document.getElementById("countdown-minutes");
const countdownSeconds = document.getElementById("countdown-seconds");

const studentForm = document.getElementById("student-form");
const classroomSelect = document.getElementById("classroom");
const studentNameSelect = document.getElementById("student-name");
const emailInput = document.getElementById("email");

const changeForm = document.getElementById("change-form");
const registeredStudentNameSelect = document.getElementById("registered-student-name");
const registeredEmailInput = document.getElementById("registered-email");

const roleForm = document.getElementById("role-form");
const roleSubtitle = document.getElementById("role-subtitle");
const roleSelect = document.getElementById("role");
const roleHint = document.getElementById("role-hint");
const studentSummary = document.getElementById("student-summary");
const backToPreviousButton = document.getElementById("back-to-previous-btn");

const partnerForm = document.getElementById("partner-form");
const partnerSubtitle = document.getElementById("partner-subtitle");
const partnerSummary = document.getElementById("partner-summary");
const partnerClassroomSelect = document.getElementById("partner-classroom");
const partnerNameSelect = document.getElementById("partner-name");
const partnerEmailInput = document.getElementById("partner-email");
const commissionSelect = document.getElementById("commission");
const backToRoleButton = document.getElementById("back-to-role-btn");

const reportScreen = document.getElementById("report-screen");
const reportForm = document.getElementById("report-form");
const reportTypeSelect = document.getElementById("report-type");
const reportFilters = document.getElementById("report-filters");
const reportClassroomSelect = document.getElementById("report-classroom");
const reportRoleSelect = document.getElementById("report-role");
const reportCommissionSelect = document.getElementById("report-commission");
const reportSummary = document.getElementById("report-summary");
const reportBackButton = document.getElementById("report-back-btn");
const reportGenerateButton = document.getElementById("report-generate-btn");

const modal = document.getElementById("feedback-modal");
const modalContent = document.getElementById("modal-content");
const modalTitle = document.getElementById("modal-title");
const modalMessage = document.getElementById("modal-message");
const closeModalButton = document.getElementById("close-modal-btn");

let statusData = {
  vacancies: {},
  registeredStudents: [],
  registeredEmails: [],
  registeredEntries: [],
};

let flowMode = null;
let currentRegistration = null;
let pendingRole = null;
let modalAfterCloseAction = null;
let supabaseClient = null;
let isStartingFlow = false;
let isSubmitting = false;
let isPartnerLocked = false;
let isGeneratingReport = false;
let registrationCountdownIntervalId = null;

function toCanonical(value) {
  return String(value || "").normalize("NFC").trim();
}

function normalize(value) {
  return toCanonical(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function isPairedRole(role) {
  return PAIRED_ROLES.has(role);
}

function toCanonicalCommission(value) {
  const cleaned = toCanonical(value);
  if (!cleaned) {
    return "";
  }

  const key = normalize(cleaned);
  return COMMISSION_CANONICAL[key] || cleaned;
}

function getProfessorPassword() {
  return PROFESSOR_SECRET_CODES.map(
    (code, index) => String.fromCharCode(code ^ PROFESSOR_SECRET_MASK[index % PROFESSOR_SECRET_MASK.length])
  ).join("");
}

function getSupabaseConfig() {
  const raw = window.APP_CONFIG || {};
  const url = String(raw.SUPABASE_URL || raw.supabaseUrl || window.SUPABASE_URL || "").trim();
  const anonKey = String(raw.SUPABASE_ANON_KEY || raw.supabaseAnonKey || window.SUPABASE_ANON_KEY || "").trim();
  const looksPlaceholder = url.includes("YOUR-PROJECT-REF") || anonKey.includes("YOUR_SUPABASE_ANON_KEY");

  return {
    url: looksPlaceholder ? "" : url,
    anonKey: looksPlaceholder ? "" : anonKey,
  };
}

function getSupabaseClient() {
  if (supabaseClient) {
    return supabaseClient;
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    throw new Error("Biblioteca do Supabase não carregou. Recarregue a página.");
  }

  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    throw new Error("Configuração do Supabase ausente em config.js.");
  }

  supabaseClient = window.supabase.createClient(url, anonKey);
  return supabaseClient;
}

function getSchoolYear(classroom) {
  const m = String(classroom || "").match(/[123]/);
  return m ? m[0] : "";
}

function allowedRolesForClassroom(classroom) {
  const year = getSchoolYear(classroom);

  if (year === "1") {
    return ["Assessor", "Deputado", "Staff"];
  }

  if (year === "2" || year === "3") {
    return ["Assessor", "Deputado", "Imprensa"];
  }

  return ["Assessor", "Deputado"];
}

function counterpartRole(role) {
  if (role === "Assessor") {
    return "Deputado";
  }

  if (role === "Deputado") {
    return "Assessor";
  }

  return null;
}

function formatRemaining(role, remaining) {
  if (UNLIMITED_ROLES.has(role) || remaining === null || typeof remaining === "undefined") {
    return "vagas ilimitadas";
  }

  const count = Number(remaining || 0);
  return `${count} vaga${count === 1 ? "" : "s"}`;
}

function setAccessLoading(isLoading) {
  isStartingFlow = isLoading;
  newRegistrationButton.disabled = isLoading;
  changeRegistrationButton.disabled = isLoading;
  accessPasswordInput.disabled = isLoading;

  if (isLoading) {
    accessLoading.classList.remove("hidden");
  } else {
    accessLoading.classList.add("hidden");
  }
}

function isRegistrationLocked(nowMs = Date.now()) {
  return nowMs < REGISTRATION_OPEN_AT_UTC_MS;
}

function getCountdownParts(remainingMs) {
  const totalSeconds = Math.max(Math.floor(remainingMs / 1000), 0);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, "0");

  return {
    days: pad(days),
    hours: pad(hours),
    minutes: pad(minutes),
    seconds: pad(seconds),
  };
}

function applyCountdownParts(parts) {
  if (countdownDays) {
    countdownDays.textContent = parts.days;
  }

  if (countdownHours) {
    countdownHours.textContent = parts.hours;
  }

  if (countdownMinutes) {
    countdownMinutes.textContent = parts.minutes;
  }

  if (countdownSeconds) {
    countdownSeconds.textContent = parts.seconds;
  }
}

function updateRegistrationCountdown() {
  if (
    !registrationCountdown ||
    !registrationCountdownValue ||
    !registrationCountdownTarget ||
    !countdownDays ||
    !countdownHours ||
    !countdownMinutes ||
    !countdownSeconds
  ) {
    return;
  }

  registrationCountdownTarget.textContent = "Hor\u00e1rio de Bras\u00edlia: 19/03/2026 \u00e0s 10h00";

  if (!isRegistrationLocked()) {
    registrationCountdown.classList.add("hidden");
    applyCountdownParts({ days: "00", hours: "00", minutes: "00", seconds: "00" });

    if (registrationCountdownIntervalId) {
      clearInterval(registrationCountdownIntervalId);
      registrationCountdownIntervalId = null;
    }
    return;
  }

  const remaining = REGISTRATION_OPEN_AT_UTC_MS - Date.now();
  registrationCountdown.classList.remove("hidden");
  applyCountdownParts(getCountdownParts(remaining));
}

function startRegistrationCountdown() {
  if (registrationCountdownIntervalId) {
    clearInterval(registrationCountdownIntervalId);
    registrationCountdownIntervalId = null;
  }

  updateRegistrationCountdown();

  if (!isRegistrationLocked()) {
    return;
  }

  registrationCountdownIntervalId = setInterval(updateRegistrationCountdown, 1000);
}
function setReportLoading(isLoading) {
  isGeneratingReport = isLoading;
  reportGenerateButton.disabled = isLoading;
  reportTypeSelect.disabled = isLoading;
  reportBackButton.disabled = isLoading;
  reportGenerateButton.textContent = isLoading ? "Gerando PDF..." : "Gerar PDF";

  const filtersHidden = reportFilters.classList.contains("hidden");
  reportClassroomSelect.disabled = isLoading || filtersHidden;
  reportRoleSelect.disabled = isLoading || filtersHidden;
  reportCommissionSelect.disabled = isLoading || filtersHidden;
}

function setPartnerFieldsLocked(locked) {
  isPartnerLocked = locked;
  partnerClassroomSelect.disabled = locked;
  partnerNameSelect.disabled = locked;
  partnerEmailInput.disabled = locked;
}

function switchScreen(target) {
  accessScreen.classList.add("hidden");
  studentScreen.classList.add("hidden");
  changeScreen.classList.add("hidden");
  roleScreen.classList.add("hidden");
  partnerScreen.classList.add("hidden");
  reportScreen.classList.add("hidden");
  target.classList.remove("hidden");
  target.classList.remove("screen-enter");
  void target.offsetWidth;
  target.classList.add("screen-enter");
}

function openModal(type, title, message, afterCloseAction = null) {
  modalTitle.textContent = title;
  modalMessage.textContent = message;
  modalAfterCloseAction = afterCloseAction;

  if (type === "error") {
    modalContent.classList.add("modal-error");
  } else {
    modalContent.classList.remove("modal-error");
  }

  modal.classList.remove("hidden");
}

function closeModal() {
  modal.classList.add("hidden");

  if (typeof modalAfterCloseAction === "function") {
    const action = modalAfterCloseAction;
    modalAfterCloseAction = null;
    action();
    return;
  }

  modalAfterCloseAction = null;
}

function resetToAccessScreen() {
  accessForm.reset();
  studentForm.reset();
  changeForm.reset();
  roleForm.reset();
  partnerForm.reset();
  reportForm.reset();
  setPartnerFieldsLocked(false);
  setReportLoading(false);

  flowMode = null;
  currentRegistration = null;
  pendingRole = null;
  isSubmitting = false;

  accessError.classList.add("hidden");
  setAccessLoading(false);
  switchScreen(accessScreen);
  updateRegistrationCountdown();
}

function applyUnavailableStudents() {
  const unavailable = new Set(statusData.registeredStudents.map((name) => normalize(name)));

  Array.from(studentNameSelect.options).forEach((option, index) => {
    if (index === 0) {
      return;
    }

    const isUnavailable = unavailable.has(normalize(option.value));
    option.disabled = isUnavailable;
    option.textContent = isUnavailable ? `${option.value} (indisponível)` : option.value;
  });
}

function populateRegisteredStudents() {
  const selected = toCanonical(registeredStudentNameSelect.value);

  const sorted = [...statusData.registeredEntries].sort((a, b) =>
    a.studentName.localeCompare(b.studentName, "pt-BR", { sensitivity: "base" })
  );

  registeredStudentNameSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Selecione o aluno";
  registeredStudentNameSelect.appendChild(placeholder);

  sorted.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.studentName;
    option.textContent = entry.studentName;
    registeredStudentNameSelect.appendChild(option);
  });

  if (selected) {
    registeredStudentNameSelect.value = selected;
  }
}

function getCurrentPairPartner() {
  if (!currentRegistration || !currentRegistration.pairGroupId) {
    return null;
  }

  return (
    statusData.registeredEntries.find(
      (entry) =>
        entry.pairGroupId &&
        entry.pairGroupId === currentRegistration.pairGroupId &&
        normalize(entry.studentName) !== normalize(currentRegistration.studentName)
    ) || null
  );
}

function populatePartnerNames() {
  const selected = toCanonical(partnerNameSelect.value);
  const unavailable = new Set(statusData.registeredStudents.map((name) => normalize(name)));
  const currentPartner = getCurrentPairPartner();
  const currentPartnerName = currentPartner ? normalize(currentPartner.studentName) : null;

  partnerNameSelect.innerHTML = '<option value="">Selecione o nome</option>';

  Array.from(studentNameSelect.options).forEach((option, index) => {
    if (index === 0) {
      return;
    }

    const name = toCanonical(option.value);
    if (!name) {
      return;
    }

    const candidate = document.createElement("option");
    candidate.value = name;
    candidate.textContent = name;

    if (currentRegistration && normalize(currentRegistration.studentName) === normalize(name)) {
      candidate.disabled = true;
    }

    const isCurrentPartner = currentPartnerName && currentPartnerName === normalize(name);
    if (unavailable.has(normalize(name)) && !isCurrentPartner) {
      candidate.disabled = true;
      candidate.textContent = `${name} (indisponível)`;
    }

    partnerNameSelect.appendChild(candidate);
  });

  if (selected) {
    partnerNameSelect.value = selected;
  }
}

function renderRoleOptions(classroom) {
  let allowedRoles = allowedRolesForClassroom(classroom);

  if (flowMode === "change" && currentRegistration && isPairedRole(currentRegistration.previousRole)) {
    allowedRoles = allowedRoles.filter((role) => isPairedRole(role));
  }

  roleSelect.innerHTML = '<option value="">Selecione o cargo</option>';

  ROLE_ORDER.forEach((role) => {
    if (!allowedRoles.includes(role)) {
      return;
    }

    const remaining = statusData.vacancies[role];
    const option = document.createElement("option");
    option.value = role;

    if (!UNLIMITED_ROLES.has(role) && Number(remaining || 0) <= 0) {
      option.disabled = true;
      option.textContent = `${role} (indisponível)`;
    } else {
      option.textContent = `${role} (${formatRemaining(role, remaining)})`;
    }

    roleSelect.appendChild(option);
  });

  if (flowMode === "change" && currentRegistration && isPairedRole(currentRegistration.previousRole)) {
    roleHint.textContent = "Deputado/Assessor só pode alterar entre Deputado e Assessor no modo mudança.";
    return;
  }

  roleHint.textContent =
    getSchoolYear(classroom) === "1"
      ? "Para turmas de 1º ano, o cargo Imprensa não é permitido."
      : "Para turmas de 2º/3º ano, o cargo Staff não é permitido.";
}

function applyStatus(status) {
  const entries = Array.isArray(status?.registeredEntries) ? status.registeredEntries : [];

  statusData = {
    vacancies: status?.vacancies || {},
    registeredStudents: (status?.registeredStudents || []).map((name) => toCanonical(name)).filter(Boolean),
    registeredEmails: (status?.registeredEmails || []).map((email) => toCanonical(email)).filter(Boolean),
    registeredEntries: entries.map((entry) => ({
      classroom: toCanonical(entry.classroom),
      studentName: toCanonical(entry.studentName),
      email: toCanonical(entry.email),
      role: toCanonical(entry.role),
      pairGroupId: entry.pairGroupId || null,
      partnerName: toCanonical(entry.partnerName),
      partnerClassroom: toCanonical(entry.partnerClassroom),
      partnerRole: toCanonical(entry.partnerRole),
      commission: toCanonicalCommission(entry.commission),
      createdAt: toCanonical(entry.createdAt),
      updatedAt: toCanonical(entry.updatedAt),
    })),
  };

  applyUnavailableStudents();
  populateRegisteredStudents();
}

async function fetchStatus() {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("app_get_status");

  if (error) {
    throw new Error(error.message || "Erro ao carregar status do sistema.");
  }

  applyStatus(data);
}

async function callAction(rpcName, payload) {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc(rpcName, payload);

  if (error) {
    const rawMessage = String(error.message || "");
    if (rawMessage.includes("Could not choose the best candidate function")) {
      throw new Error("Funções RPC desatualizadas no Supabase. Execute novamente supabase/schema.sql.");
    }

    throw new Error(rawMessage || "Falha ao executar operação no Supabase.");
  }

  return data;
}

async function openReportsArea() {
  setAccessLoading(true);

  try {
    await fetchStatus();
    flowMode = "reports";
    populateReportFilters({ classroom: "all", role: "all", commission: "all" });
    reportTypeSelect.value = "registered";
    toggleReportFilters();
    switchScreen(reportScreen);
  } catch (error) {
    openModal("error", "Erro", error.message || "Não foi possível carregar a área de relatórios.");
  } finally {
    setAccessLoading(false);
  }
}

async function startFlow(mode) {
  if (isStartingFlow) {
    return;
  }

  const typedPassword = toCanonical(accessPasswordInput.value);

  if (typedPassword === getProfessorPassword()) {
    accessError.classList.add("hidden");

    try {
      getSupabaseClient();
    } catch (error) {
      openModal("error", "Configura\u00e7\u00e3o pendente", error.message);
      return;
    }

    await openReportsArea();
    return;
  }

  if (isRegistrationLocked()) {
    accessError.classList.add("hidden");
    updateRegistrationCountdown();
    openModal("error", "Inscri\u00e7\u00f5es temporariamente fechadas", REGISTRATION_LOCK_MESSAGE);
    return;
  }

  try {
    getSupabaseClient();
  } catch (error) {
    openModal("error", "Configura\u00e7\u00e3o pendente", error.message);
    return;
  }

  if (typedPassword !== APP_PASSWORD) {
    accessError.classList.remove("hidden");
    return;
  }

  accessError.classList.add("hidden");
  setAccessLoading(true);

  try {
    await fetchStatus();
    flowMode = mode;

    if (mode === "new") {
      switchScreen(studentScreen);
    } else {
      switchScreen(changeScreen);
    }
  } catch (error) {
    openModal("error", "Erro", error.message || "N\u00e3o foi poss\u00edvel carregar os dados.");
  } finally {
    setAccessLoading(false);
  }
}

async function finalizeRegistration(role, partnerPayload, commission) {
  const rpcName = flowMode === "new" ? "app_new_registration" : "app_change_registration";

  const result = await callAction(rpcName, {
    p_classroom: currentRegistration.classroom,
    p_student_name: currentRegistration.studentName,
    p_email: currentRegistration.email,
    p_role: role,
    p_partner_classroom: partnerPayload?.classroom || null,
    p_partner_student_name: partnerPayload?.studentName || null,
    p_partner_email: partnerPayload?.email || null,
    p_commission: commission || null,
  });

  applyStatus(result.status);

  if (!result.ok) {
    openRegistrationError(result);
    return;
  }

  const successTitle = flowMode === "new" ? "Cadastro realizado com sucesso!" : "Mudança de cadastro concluída!";
  const remainingText = formatRemaining(role, result.remainingForRole);
  const commissionText = commission ? ` Comissão: ${commission}.` : "";
  const successMessage =
    flowMode === "new"
      ? `Cargo: ${role}. Disponibilidade: ${remainingText}.${commissionText}`
      : `Cadastro atualizado para ${role}. Disponibilidade: ${remainingText}.${commissionText}`;

  openModal("success", successTitle, successMessage, resetToAccessScreen);
}

function openRegistrationError(result) {
  const code = String(result?.code || "");
  const fallbackMessage = result?.message || "Não foi possível concluir a operação.";

  if (code === "EMAIL_EXISTS") {
    openModal("error", "E-mail já cadastrado", "Este e-mail já foi utilizado. Use outro e-mail.");
    return;
  }

  if (code === "STUDENT_EXISTS") {
    openModal("error", "Aluno indisponível", "Esse aluno já foi cadastrado e não pode ser selecionado novamente.");
    return;
  }

  if (code === "EMAIL_MISMATCH") {
    openModal("error", "E-mail divergente", "O e-mail informado não corresponde ao cadastro do aluno.");
    return;
  }

  if (code === "PARTNER_REQUIRED") {
    openModal("error", "Parceiro obrigatório", "Para Assessor/Deputado é obrigatório incluir parceiro e comissão.");
    return;
  }

  if (code === "PARTNER_LOCKED") {
    openModal("error", "Parceiro travado", "Mudança de cadastro de Deputado/Assessor deve manter o mesmo colega.");
    return;
  }

  if (code === "ROLE_RESTRICTED_PAIRED") {
    openModal("error", "Cargo bloqueado", "Deputado/Assessor não pode mudar para Imprensa ou Staff na mudança.");
    return;
  }

  if (code === "INVALID_COMMISSION") {
    openModal("error", "Comissão obrigatória", "Escolha uma comissão válida para Deputado/Assessor.");
    return;
  }

  if (code === "PARTNER_SAME_STUDENT") {
    openModal("error", "Parceiro inválido", "O parceiro deve ser um aluno diferente e com outro e-mail.");
    return;
  }

  if (code === "PARTNER_STUDENT_EXISTS") {
    openModal("error", "Parceiro indisponível", "O nome do parceiro já está cadastrado no sistema.");
    return;
  }

  if (code === "PARTNER_EMAIL_EXISTS") {
    openModal("error", "E-mail do parceiro em uso", "O e-mail informado para o parceiro já está associado a outro cadastro.");
    return;
  }

  if (code === "PARTNER_EMAIL_MISMATCH") {
    openModal("error", "E-mail do parceiro divergente", "O e-mail não corresponde ao nome do parceiro selecionado.");
    return;
  }

  if (code === "PARTNER_ROLE_NOT_ALLOWED") {
    openModal("error", "Turma do parceiro inválida", "A turma escolhida não permite o cargo obrigatório do parceiro.");
    return;
  }

  if (code === "ROLE_NOT_ALLOWED") {
    openModal("error", "Cargo não permitido", "Esse cargo não pode ser selecionado para a turma informada.");
    return;
  }

  if (code === "NO_VACANCY") {
    openModal("error", "Sem vagas", "Não há vagas disponíveis para este cargo no momento.");
    return;
  }

  if (code === "RECORD_NOT_FOUND") {
    openModal("error", "Cadastro não encontrado", "Não localizamos esse cadastro. Verifique os dados.");
    return;
  }

  openModal("error", "Erro no cadastro", fallbackMessage);
}

function setSelectOptions(selectElement, options, allLabel, preserveValue = "all") {
  const selected = preserveValue && options.includes(preserveValue) ? preserveValue : "all";
  selectElement.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = allLabel;
  selectElement.appendChild(allOption);

  options.forEach((item) => {
    const option = document.createElement("option");
    option.value = item;
    option.textContent = item;
    selectElement.appendChild(option);
  });

  selectElement.value = selected;
}

function populateReportFilters(preserve = {}) {
  const classrooms = Array.from(new Set(statusData.registeredEntries.map((entry) => entry.classroom).filter(Boolean))).sort(
    (a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" })
  );

  const commissions = Array.from(
    new Set([
      ...COMMISSION_OPTIONS,
      ...statusData.registeredEntries
        .map((entry) => toCanonicalCommission(entry.commission))
        .filter(Boolean),
    ])
  ).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));

  setSelectOptions(reportClassroomSelect, classrooms, "Todas", preserve.classroom || reportClassroomSelect.value || "all");
  setSelectOptions(reportRoleSelect, ROLE_ORDER, "Todos", preserve.role || reportRoleSelect.value || "all");
  setSelectOptions(reportCommissionSelect, commissions, "Todas", preserve.commission || reportCommissionSelect.value || "all");
}

function setReportSummaryByType(type) {
  if (type === "partners") {
    reportSummary.textContent = "Duplas Deputado/Assessor com comissão escolhida e data/hora de cadastro.";
    return;
  }

  if (type === "vacancies") {
    reportSummary.textContent = "Resumo de vagas ocupadas/livres por cargo e inscritos por comissão.";
    return;
  }

  if (type === "not-registered") {
    reportSummary.textContent = "Lista de alunos disponíveis que ainda não se inscreveram em nenhum cargo.";
    return;
  }

  reportSummary.textContent = "Relatório completo de cadastrados com filtros por turma, cargo e comissão.";
}

function toggleReportFilters() {
  const isRegisteredReport = reportTypeSelect.value === "registered";
  reportFilters.classList.toggle("hidden", !isRegisteredReport);

  reportClassroomSelect.disabled = !isRegisteredReport || isGeneratingReport;
  reportRoleSelect.disabled = !isRegisteredReport || isGeneratingReport;
  reportCommissionSelect.disabled = !isRegisteredReport || isGeneratingReport;

  setReportSummaryByType(reportTypeSelect.value);
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFileStamp(date) {
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function ensurePdfLibs() {
  const jsPdfConstructor = window?.jspdf?.jsPDF;
  if (typeof jsPdfConstructor !== "function") {
    throw new Error("Biblioteca de PDF não carregada. Recarregue a página e tente novamente.");
  }

  return jsPdfConstructor;
}

function createReportDocument(title, subtitle, orientation = "p") {
  const JsPdf = ensurePdfLibs();
  const doc = new JsPdf({ unit: "mm", format: "a4", orientation });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(6, 20, 47);
  doc.rect(0, 0, pageWidth, 26, "F");
  doc.setFillColor(163, 24, 54);
  doc.rect(0, 26, pageWidth, 2, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("FÓRUM HUMANIDADES 2026", 12, 11);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.8);
  doc.text("Colégios Univap Aquarius", 12, 17);

  doc.setTextColor(11, 31, 71);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(title, 12, 36);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(82, 99, 132);
  doc.text(subtitle, 12, 42);

  return { doc, startY: 48 };
}

function applyPdfFooter(doc) {
  const stamp = `Gerado em ${new Date().toLocaleString("pt-BR")}`;
  const pages = doc.getNumberOfPages();

  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120, 130, 150);
    doc.text(stamp, 12, pageHeight - 5);
    doc.text(`Página ${page} de ${pages}`, pageWidth - 12, pageHeight - 5, { align: "right" });
  }
}

function getAutoTableConfig(doc) {
  if (typeof doc.autoTable !== "function") {
    throw new Error("Extensão de tabela PDF não carregada. Recarregue a página e tente novamente.");
  }

  return {
    margin: { left: 10, right: 10 },
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 2.2,
      textColor: [20, 30, 54],
      lineColor: [214, 223, 238],
      lineWidth: 0.1,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [11, 31, 71],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      lineColor: [11, 31, 71],
    },
    alternateRowStyles: {
      fillColor: [247, 250, 255],
    },
    bodyStyles: {
      valign: "top",
    },
  };
}

function getRegisteredEntriesFiltered() {
  const classroomFilter = reportClassroomSelect.value;
  const roleFilter = reportRoleSelect.value;
  const commissionFilter = reportCommissionSelect.value;

  return statusData.registeredEntries.filter((entry) => {
    if (classroomFilter !== "all" && entry.classroom !== classroomFilter) {
      return false;
    }

    if (roleFilter !== "all" && entry.role !== roleFilter) {
      return false;
    }

    if (commissionFilter !== "all" && toCanonicalCommission(entry.commission) !== commissionFilter) {
      return false;
    }

    return true;
  });
}

function getReportActiveFiltersLabel() {
  const labels = [];

  if (reportClassroomSelect.value !== "all") {
    labels.push(`Turma: ${reportClassroomSelect.value}`);
  }

  if (reportRoleSelect.value !== "all") {
    labels.push(`Cargo: ${reportRoleSelect.value}`);
  }

  if (reportCommissionSelect.value !== "all") {
    labels.push(`Comissão: ${reportCommissionSelect.value}`);
  }

  return labels.length ? labels.join(" | ") : "Sem filtros (todos os cadastros).";
}

function generateRegisteredReportPdf() {
  const rows = getRegisteredEntriesFiltered().sort((a, b) =>
    a.studentName.localeCompare(b.studentName, "pt-BR", { sensitivity: "base" })
  );

  const { doc, startY } = createReportDocument(
    "Relatório de Cadastrados",
    "Relação completa de alunos cadastrados com filtros aplicados.",
    "l"
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.2);
  doc.setTextColor(52, 69, 102);
  doc.text(`Total de registros: ${rows.length}`, 12, startY);
  doc.text(`Filtros ativos: ${getReportActiveFiltersLabel()}`, 12, startY + 5);

  if (!rows.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(11, 31, 71);
    doc.text("Nenhum cadastro encontrado para os filtros selecionados.", 12, startY + 16);
    applyPdfFooter(doc);
    doc.save(`relatorio-cadastrados-${formatFileStamp(new Date())}.pdf`);
    return;
  }

  const tableRows = rows.map((entry) => [
    entry.studentName || "-",
    entry.classroom || "-",
    entry.role || "-",
    toCanonicalCommission(entry.commission) || "-",
    entry.partnerName || "-",
    formatDateTime(entry.createdAt || entry.updatedAt),
  ]);

  const tableConfig = getAutoTableConfig(doc);
  doc.autoTable({
    ...tableConfig,
    startY: startY + 10,
    head: [["Aluno", "Turma", "Cargo", "Comissão", "Parceiro", "Data/Hora"]],
    body: tableRows,
    columnStyles: {
      0: { cellWidth: 66 },
      1: { cellWidth: 24 },
      2: { cellWidth: 23 },
      3: { cellWidth: 47 },
      4: { cellWidth: 72 },
      5: { cellWidth: 35 },
    },
  });

  applyPdfFooter(doc);
  doc.save(`relatorio-cadastrados-${formatFileStamp(new Date())}.pdf`);
}

function getAllStudentNames() {
  return Array.from(studentNameSelect.options)
    .slice(1)
    .map((option) => toCanonical(option.value))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
}

function getNotRegisteredStudents() {
  const registered = new Set(statusData.registeredStudents.map((name) => normalize(name)));
  return getAllStudentNames().filter((name) => !registered.has(normalize(name)));
}

function generateNotRegisteredReportPdf() {
  const notRegistered = getNotRegisteredStudents();
  const { doc, startY } = createReportDocument(
    "Relatório de Não Inscritos",
    "Alunos disponíveis que ainda não estão inscritos em nenhum cargo."
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.2);
  doc.setTextColor(52, 69, 102);
  doc.text(`Total de alunos não inscritos: ${notRegistered.length}`, 12, startY);

  if (!notRegistered.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(11, 31, 71);
    doc.text("Todos os alunos da lista já estão inscritos.", 12, startY + 11);
    applyPdfFooter(doc);
    doc.save(`relatorio-nao-inscritos-${formatFileStamp(new Date())}.pdf`);
    return;
  }

  const tableConfig = getAutoTableConfig(doc);
  doc.autoTable({
    ...tableConfig,
    startY: startY + 4,
    head: [["Aluno", "Situação"]],
    body: notRegistered.map((name) => [name, "Não inscrito"]),
    columnStyles: {
      0: { cellWidth: 140 },
      1: { cellWidth: 58 },
    },
  });

  applyPdfFooter(doc);
  doc.save(`relatorio-nao-inscritos-${formatFileStamp(new Date())}.pdf`);
}
function getPartnerGroups() {
  const buckets = new Map();

  statusData.registeredEntries
    .filter((entry) => isPairedRole(entry.role))
    .forEach((entry) => {
      const selfKey = normalize(entry.studentName);
      const partnerKey = normalize(entry.partnerName);
      const fallbackKey = partnerKey ? [selfKey, partnerKey].sort().join("|") : `${selfKey}|sem-parceiro`;
      const groupKey = entry.pairGroupId || fallbackKey;

      if (!buckets.has(groupKey)) {
        buckets.set(groupKey, []);
      }

      const bucket = buckets.get(groupKey);
      if (!bucket.some((item) => normalize(item.studentName) === selfKey)) {
        bucket.push(entry);
      }
    });

  return Array.from(buckets.values())
    .map((bucket) => {
      const deputy = bucket.find((entry) => entry.role === "Deputado") || null;
      const advisor = bucket.find((entry) => entry.role === "Assessor") || null;
      const first = deputy || advisor || bucket[0] || {};
      const commission = toCanonicalCommission(
        (deputy && deputy.commission) ||
          (advisor && advisor.commission) ||
          bucket.map((entry) => entry.commission).find(Boolean) ||
          ""
      );

      return {
        deputyName: deputy ? deputy.studentName : "-",
        deputyClassroom: deputy ? deputy.classroom : "-",
        advisorName: advisor ? advisor.studentName : "-",
        advisorClassroom: advisor ? advisor.classroom : "-",
        commission: commission || "-",
        timestamp: first.createdAt || first.updatedAt || "",
        link: deputy && advisor ? `${deputy.studentName} <-> ${advisor.studentName}` : "Vínculo incompleto",
      };
    })
    .sort((a, b) =>
      `${a.deputyName} ${a.advisorName}`.localeCompare(`${b.deputyName} ${b.advisorName}`, "pt-BR", {
        sensitivity: "base",
      })
    );
}

function generatePartnersReportPdf() {
  const groups = getPartnerGroups();

  const { doc, startY } = createReportDocument(
    "Relatório de Parceiros",
    "Duplas Deputado/Assessor, vínculo, comissão e data/hora de cadastro.",
    "l"
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.2);
  doc.setTextColor(52, 69, 102);
  doc.text(`Total de duplas: ${groups.length}`, 12, startY);

  if (!groups.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(11, 31, 71);
    doc.text("Nenhuma dupla Deputado/Assessor cadastrada até o momento.", 12, startY + 11);
    applyPdfFooter(doc);
    doc.save(`relatorio-parceiros-${formatFileStamp(new Date())}.pdf`);
    return;
  }

  const tableRows = groups.map((group) => [
    group.deputyName,
    group.deputyClassroom,
    group.advisorName,
    group.advisorClassroom,
    group.link,
    group.commission,
    formatDateTime(group.timestamp),
  ]);

  const tableConfig = getAutoTableConfig(doc);
  doc.autoTable({
    ...tableConfig,
    startY: startY + 5,
    head: [["Deputado", "Turma Dep.", "Assessor", "Turma Ass.", "Vínculo", "Comissão", "Data/Hora"]],
    body: tableRows,
    columnStyles: {
      0: { cellWidth: 51 },
      1: { cellWidth: 22 },
      2: { cellWidth: 51 },
      3: { cellWidth: 22 },
      4: { cellWidth: 66 },
      5: { cellWidth: 40 },
      6: { cellWidth: 25 },
    },
  });

  applyPdfFooter(doc);
  doc.save(`relatorio-parceiros-${formatFileStamp(new Date())}.pdf`);
}

function generateVacanciesReportPdf() {
  const usedByRole = statusData.registeredEntries.reduce((map, entry) => {
    map.set(entry.role, (map.get(entry.role) || 0) + 1);
    return map;
  }, new Map());

  const roleRows = ROLE_ORDER.map((role) => {
    const used = usedByRole.get(role) || 0;
    const limit = LIMITED_ROLE_MAX[role];
    const free = limit === null ? "Ilimitadas" : String(Math.max(limit - used, 0));
    const capacity = limit === null ? "Ilimitada" : String(limit);
    const status = limit === null ? "Disponível" : Number(free) > 0 ? "Disponível" : "Esgotado";

    return [role, String(used), capacity, free, status];
  });

  const commissionCounter = new Map();
  COMMISSION_OPTIONS.forEach((commission) => {
    commissionCounter.set(commission, 0);
  });

  statusData.registeredEntries.forEach((entry) => {
    const commission = toCanonicalCommission(entry.commission);
    if (!commission) {
      return;
    }

    commissionCounter.set(commission, (commissionCounter.get(commission) || 0) + 1);
  });

  const commissionRows = Array.from(commissionCounter.entries())
    .sort((a, b) => a[0].localeCompare(b[0], "pt-BR", { sensitivity: "base" }))
    .map(([commission, count]) => [commission, String(count)]);

  const { doc, startY } = createReportDocument(
    "Relatório de Vagas",
    "Ocupação por cargo, vagas livres e inscritos por comissão."
  );

  const tableConfig = getAutoTableConfig(doc);
  doc.autoTable({
    ...tableConfig,
    startY,
    head: [["Cargo", "Inscritos", "Capacidade", "Vagas Livres", "Status"]],
    body: roleRows,
    columnStyles: {
      0: { cellWidth: 48 },
      1: { cellWidth: 28 },
      2: { cellWidth: 32 },
      3: { cellWidth: 35 },
      4: { cellWidth: 34 },
    },
  });

  const nextY = (doc.lastAutoTable?.finalY || startY) + 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(11, 31, 71);
  doc.text("Inscritos por comissão", 12, nextY);

  doc.autoTable({
    ...tableConfig,
    startY: nextY + 3,
    head: [["Comissão", "Quantidade de inscritos"]],
    body: commissionRows,
    columnStyles: {
      0: { cellWidth: 120 },
      1: { cellWidth: 58 },
    },
  });

  applyPdfFooter(doc);
  doc.save(`relatorio-vagas-${formatFileStamp(new Date())}.pdf`);
}

async function generateSelectedReport() {
  if (isGeneratingReport) {
    return;
  }

  setReportLoading(true);

  try {
    const preserve = {
      classroom: reportClassroomSelect.value,
      role: reportRoleSelect.value,
      commission: reportCommissionSelect.value,
    };

    await fetchStatus();
    populateReportFilters(preserve);
    toggleReportFilters();

    const type = reportTypeSelect.value;

    if (type === "partners") {
      generatePartnersReportPdf();
    } else if (type === "vacancies") {
      generateVacanciesReportPdf();
    } else if (type === "not-registered") {
      generateNotRegisteredReportPdf();
    } else {
      generateRegisteredReportPdf();
    }
  } catch (error) {
    openModal("error", "Erro ao gerar relatório", error.message || "Não foi possível gerar o PDF.");
  } finally {
    setReportLoading(false);
  }
}

reportTypeSelect.addEventListener("change", () => {
  toggleReportFilters();
});

reportForm.addEventListener("submit", (event) => {
  event.preventDefault();
  generateSelectedReport();
});

reportBackButton.addEventListener("click", () => {
  resetToAccessScreen();
});
newRegistrationButton.addEventListener("click", () => startFlow("new"));
changeRegistrationButton.addEventListener("click", () => startFlow("change"));

accessForm.addEventListener("submit", (event) => {
  event.preventDefault();
  startFlow("new");
});

studentForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const classroom = toCanonical(classroomSelect.value);
  const studentName = toCanonical(studentNameSelect.value);
  const email = toCanonical(emailInput.value);

  if (!classroom || !studentName || !email) {
    openModal("error", "Dados incompletos", "Preencha turma, nome e e-mail para continuar.");
    return;
  }

  const unavailable = new Set(statusData.registeredStudents.map((name) => normalize(name)));
  if (unavailable.has(normalize(studentName))) {
    openModal("error", "Aluno indisponível", "Esse aluno já foi cadastrado e não pode ser selecionado novamente.");
    return;
  }

  const usedEmails = new Set(statusData.registeredEmails.map((value) => normalize(value)));
  if (usedEmails.has(normalize(email))) {
    openModal("error", "E-mail já cadastrado", "Este e-mail já foi utilizado. Use outro e-mail.");
    return;
  }

  currentRegistration = { classroom, studentName, email, previousRole: null, pairGroupId: null, commission: "" };
  roleSubtitle.textContent = "Etapa 2: Escolha do cargo";
  studentSummary.textContent = `Turma: ${classroom} | Aluno: ${studentName} | E-mail: ${email}`;
  renderRoleOptions(classroom);
  switchScreen(roleScreen);
});

changeForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const studentName = toCanonical(registeredStudentNameSelect.value);
  const email = toCanonical(registeredEmailInput.value);

  if (!studentName || !email) {
    openModal("error", "Dados incompletos", "Selecione o aluno e informe o e-mail cadastrado.");
    return;
  }

  const entry = statusData.registeredEntries.find(
    (item) => normalize(item.studentName) === normalize(studentName)
  );

  if (!entry) {
    openModal("error", "Cadastro não encontrado", "Não foi possível localizar esse aluno nos registros.");
    return;
  }

  if (normalize(entry.email) !== normalize(email)) {
    openModal("error", "E-mail divergente", "O e-mail informado não corresponde ao e-mail cadastrado desse aluno.");
    return;
  }

  currentRegistration = {
    classroom: entry.classroom,
    studentName: entry.studentName,
    email: entry.email,
    previousRole: entry.role,
    pairGroupId: entry.pairGroupId || null,
    commission: entry.commission || "",
  };

  roleSubtitle.textContent = "Etapa 2: Escolha o novo cargo";
  studentSummary.textContent = `Turma: ${entry.classroom} | Aluno: ${entry.studentName} | Cargo atual: ${entry.role}`;
  renderRoleOptions(entry.classroom);
  switchScreen(roleScreen);
});

roleForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isSubmitting) {
    return;
  }

  if (!currentRegistration || !flowMode) {
    openModal("error", "Fluxo inválido", "Refaça o processo a partir da tela inicial.");
    resetToAccessScreen();
    return;
  }

  const role = toCanonical(roleSelect.value);
  if (!role) {
    openModal("error", "Cargo obrigatório", "Selecione um cargo para continuar.");
    return;
  }

  pendingRole = role;

  if (!isPairedRole(role)) {
    try {
      isSubmitting = true;
      await finalizeRegistration(role, null, null);
    } catch (error) {
      openModal("error", "Erro", error.message || "Não foi possível comunicar com o Supabase.");
    } finally {
      isSubmitting = false;
    }
    return;
  }

  const partnerRole = counterpartRole(role);
  const currentPartner = getCurrentPairPartner();
  const isLockedChange = flowMode === "change" && currentRegistration && isPairedRole(currentRegistration.previousRole);

  partnerForm.reset();
  setPartnerFieldsLocked(false);
  populatePartnerNames();

  partnerSubtitle.textContent = "Etapa 3: Parceiro e comissão";

  if (isLockedChange) {
    if (!currentPartner) {
      openModal("error", "Parceiro não encontrado", "Não existe parceiro vinculado para este cadastro.");
      return;
    }

    partnerSummary.textContent = `${currentRegistration.studentName} e ${currentPartner.studentName} devem permanecer juntos nesta mudança.`;
    partnerClassroomSelect.value = currentPartner.classroom;
    partnerNameSelect.value = currentPartner.studentName;
    partnerEmailInput.value = currentPartner.email;
    setPartnerFieldsLocked(true);
  } else {
    partnerSummary.textContent = `${currentRegistration.studentName} (${role}) precisa de parceiro com cargo ${partnerRole}.`;
  }

  if (flowMode === "change" && currentRegistration.commission) {
    commissionSelect.value = currentRegistration.commission;
  }

  switchScreen(partnerScreen);
});

partnerForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isSubmitting) {
    return;
  }

  if (!currentRegistration || !pendingRole) {
    openModal("error", "Fluxo inválido", "Refaça o processo a partir da tela inicial.");
    resetToAccessScreen();
    return;
  }

  const commission = toCanonicalCommission(commissionSelect.value);
  if (!commission) {
    openModal("error", "Comissão obrigatória", "Selecione a comissão antes de finalizar.");
    return;
  }

  const partnerClassroom = toCanonical(partnerClassroomSelect.value);
  const partnerName = toCanonical(partnerNameSelect.value);
  const partnerEmail = toCanonical(partnerEmailInput.value);

  if (!partnerClassroom || !partnerName || !partnerEmail) {
    openModal("error", "Dados incompletos", "Preencha turma, nome e e-mail do parceiro.");
    return;
  }

  if (!isPartnerLocked) {
    if (normalize(partnerName) === normalize(currentRegistration.studentName)) {
      openModal("error", "Parceiro inválido", "O parceiro deve ser um aluno diferente do cadastro principal.");
      return;
    }

    if (normalize(partnerEmail) === normalize(currentRegistration.email)) {
      openModal("error", "Parceiro inválido", "O e-mail do parceiro deve ser diferente do cadastro principal.");
      return;
    }
  }

  try {
    isSubmitting = true;
    await finalizeRegistration(
      pendingRole,
      {
        classroom: partnerClassroom,
        studentName: partnerName,
        email: partnerEmail,
      },
      commission
    );
  } catch (error) {
    openModal("error", "Erro", error.message || "Não foi possível comunicar com o Supabase.");
  } finally {
    isSubmitting = false;
  }
});

backToPreviousButton.addEventListener("click", () => {
  if (flowMode === "change") {
    switchScreen(changeScreen);
    return;
  }

  switchScreen(studentScreen);
});

backToRoleButton.addEventListener("click", () => {
  switchScreen(roleScreen);
});

closeModalButton.addEventListener("click", closeModal);

modal.addEventListener("click", (event) => {
  if (event.target === modal) {
    closeModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modal.classList.contains("hidden")) {
    closeModal();
  }
});

window.addEventListener("error", (event) => {
  openModal("error", "Erro no app", event.message || "Ocorreu um erro inesperado no carregamento.");
});

setAccessLoading(false);
modal.classList.add("hidden");
startRegistrationCountdown();
switchScreen(accessScreen);
  updateRegistrationCountdown();





































