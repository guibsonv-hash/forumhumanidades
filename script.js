const APP_PASSWORD = "univ@p.humanidades";
const ROLE_ORDER = ["Assessor", "Deputado", "Imprensa", "Staff"];
const UNLIMITED_ROLES = new Set(["Assessor", "Deputado"]);
const PAIRED_ROLES = new Set(["Assessor", "Deputado"]);

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
    throw new Error("Biblioteca do Supabase nao carregou. Recarregue a pagina.");
  }

  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    throw new Error("Configuracao do Supabase ausente em config.js.");
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
  target.classList.remove("hidden");
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
  setPartnerFieldsLocked(false);

  flowMode = null;
  currentRegistration = null;
  pendingRole = null;
  isSubmitting = false;

  accessError.classList.add("hidden");
  setAccessLoading(false);
  switchScreen(accessScreen);
}

function applyUnavailableStudents() {
  const unavailable = new Set(statusData.registeredStudents.map((name) => normalize(name)));

  Array.from(studentNameSelect.options).forEach((option, index) => {
    if (index === 0) {
      return;
    }

    const isUnavailable = unavailable.has(normalize(option.value));
    option.disabled = isUnavailable;
    option.textContent = isUnavailable ? `${option.value} (indisponivel)` : option.value;
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
      candidate.textContent = `${name} (indisponivel)`;
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
      option.textContent = `${role} (indisponivel)`;
    } else {
      option.textContent = `${role} (${formatRemaining(role, remaining)})`;
    }

    roleSelect.appendChild(option);
  });

  if (flowMode === "change" && currentRegistration && isPairedRole(currentRegistration.previousRole)) {
    roleHint.textContent = "Deputado/Assessor so pode alterar entre Deputado e Assessor no modo mudanca.";
    return;
  }

  roleHint.textContent =
    getSchoolYear(classroom) === "1"
      ? "Para turmas de 1o ano, o cargo Imprensa nao e permitido."
      : "Para turmas de 2o/3o ano, o cargo Staff nao e permitido.";
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
      commission: toCanonical(entry.commission),
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
      throw new Error("Funcoes RPC desatualizadas no Supabase. Execute novamente supabase/schema.sql.");
    }

    throw new Error(rawMessage || "Falha ao executar operacao no Supabase.");
  }

  return data;
}

async function startFlow(mode) {
  if (isStartingFlow) {
    return;
  }

  try {
    getSupabaseClient();
  } catch (error) {
    openModal("error", "Configuracao pendente", error.message);
    return;
  }

  if (toCanonical(accessPasswordInput.value) !== APP_PASSWORD) {
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
    openModal("error", "Erro", error.message || "Nao foi possivel carregar os dados.");
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

  const successTitle = flowMode === "new" ? "Cadastro realizado com sucesso!" : "Mudanca de cadastro concluida!";
  const remainingText = formatRemaining(role, result.remainingForRole);
  const commissionText = commission ? ` Comissao: ${commission}.` : "";
  const successMessage =
    flowMode === "new"
      ? `Cargo: ${role}. Disponibilidade: ${remainingText}.${commissionText}`
      : `Cadastro atualizado para ${role}. Disponibilidade: ${remainingText}.${commissionText}`;

  openModal("success", successTitle, successMessage, resetToAccessScreen);
}

function openRegistrationError(result) {
  const code = String(result?.code || "");
  const fallbackMessage = result?.message || "Nao foi possivel concluir a operacao.";

  if (code === "EMAIL_EXISTS") {
    openModal("error", "E-mail ja cadastrado", "Este e-mail ja foi utilizado. Use outro e-mail.");
    return;
  }

  if (code === "STUDENT_EXISTS") {
    openModal("error", "Aluno indisponivel", "Esse aluno ja foi cadastrado e nao pode ser selecionado novamente.");
    return;
  }

  if (code === "EMAIL_MISMATCH") {
    openModal("error", "E-mail divergente", "O e-mail informado nao corresponde ao cadastro do aluno.");
    return;
  }

  if (code === "PARTNER_REQUIRED") {
    openModal("error", "Parceiro obrigatorio", "Para Assessor/Deputado e obrigatorio incluir parceiro e comissao.");
    return;
  }

  if (code === "PARTNER_LOCKED") {
    openModal("error", "Parceiro travado", "Mudanca de cadastro de Deputado/Assessor deve manter o mesmo colega.");
    return;
  }

  if (code === "ROLE_RESTRICTED_PAIRED") {
    openModal("error", "Cargo bloqueado", "Deputado/Assessor nao pode mudar para Imprensa ou Staff na mudanca.");
    return;
  }

  if (code === "INVALID_COMMISSION") {
    openModal("error", "Comissao obrigatoria", "Escolha uma comissao valida para Deputado/Assessor.");
    return;
  }

  if (code === "PARTNER_SAME_STUDENT") {
    openModal("error", "Parceiro invalido", "O parceiro deve ser um aluno diferente e com outro e-mail.");
    return;
  }

  if (code === "PARTNER_STUDENT_EXISTS") {
    openModal("error", "Parceiro indisponivel", "O nome do parceiro ja esta cadastrado no sistema.");
    return;
  }

  if (code === "PARTNER_EMAIL_EXISTS") {
    openModal("error", "E-mail do parceiro em uso", "O e-mail informado para o parceiro ja esta associado a outro cadastro.");
    return;
  }

  if (code === "PARTNER_EMAIL_MISMATCH") {
    openModal("error", "E-mail do parceiro divergente", "O e-mail nao corresponde ao nome do parceiro selecionado.");
    return;
  }

  if (code === "PARTNER_ROLE_NOT_ALLOWED") {
    openModal("error", "Turma do parceiro invalida", "A turma escolhida nao permite o cargo obrigatorio do parceiro.");
    return;
  }

  if (code === "ROLE_NOT_ALLOWED") {
    openModal("error", "Cargo nao permitido", "Esse cargo nao pode ser selecionado para a turma informada.");
    return;
  }

  if (code === "NO_VACANCY") {
    openModal("error", "Sem vagas", "Nao ha vagas disponiveis para este cargo no momento.");
    return;
  }

  if (code === "RECORD_NOT_FOUND") {
    openModal("error", "Cadastro nao encontrado", "Nao localizamos esse cadastro. Verifique os dados.");
    return;
  }

  openModal("error", "Erro no cadastro", fallbackMessage);
}

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
    openModal("error", "Aluno indisponivel", "Esse aluno ja foi cadastrado e nao pode ser selecionado novamente.");
    return;
  }

  const usedEmails = new Set(statusData.registeredEmails.map((value) => normalize(value)));
  if (usedEmails.has(normalize(email))) {
    openModal("error", "E-mail ja cadastrado", "Este e-mail ja foi utilizado. Use outro e-mail.");
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
    openModal("error", "Cadastro nao encontrado", "Nao foi possivel localizar esse aluno nos registros.");
    return;
  }

  if (normalize(entry.email) !== normalize(email)) {
    openModal("error", "E-mail divergente", "O e-mail informado nao corresponde ao e-mail cadastrado desse aluno.");
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
    openModal("error", "Fluxo invalido", "Refaca o processo a partir da tela inicial.");
    resetToAccessScreen();
    return;
  }

  const role = toCanonical(roleSelect.value);
  if (!role) {
    openModal("error", "Cargo obrigatorio", "Selecione um cargo para continuar.");
    return;
  }

  pendingRole = role;

  if (!isPairedRole(role)) {
    try {
      isSubmitting = true;
      await finalizeRegistration(role, null, null);
    } catch (error) {
      openModal("error", "Erro", error.message || "Nao foi possivel comunicar com o Supabase.");
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

  partnerSubtitle.textContent = "Etapa 3: Parceiro e comissao";

  if (isLockedChange) {
    if (!currentPartner) {
      openModal("error", "Parceiro nao encontrado", "Nao existe parceiro vinculado para este cadastro.");
      return;
    }

    partnerSummary.textContent = `${currentRegistration.studentName} e ${currentPartner.studentName} devem permanecer juntos nesta mudanca.`;
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
    openModal("error", "Fluxo invalido", "Refaca o processo a partir da tela inicial.");
    resetToAccessScreen();
    return;
  }

  const commission = toCanonical(commissionSelect.value);
  if (!commission) {
    openModal("error", "Comissao obrigatoria", "Selecione a comissao antes de finalizar.");
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
      openModal("error", "Parceiro invalido", "O parceiro deve ser um aluno diferente do cadastro principal.");
      return;
    }

    if (normalize(partnerEmail) === normalize(currentRegistration.email)) {
      openModal("error", "Parceiro invalido", "O e-mail do parceiro deve ser diferente do cadastro principal.");
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
    openModal("error", "Erro", error.message || "Nao foi possivel comunicar com o Supabase.");
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
switchScreen(accessScreen);
