const APP_PASSWORD = "univ@p.humanidades";
const ROLE_ORDER = ["Assessor", "Deputado", "Imprensa", "Staff"];

const accessScreen = document.getElementById("access-screen");
const studentScreen = document.getElementById("student-screen");
const changeScreen = document.getElementById("change-screen");
const roleScreen = document.getElementById("role-screen");

const accessForm = document.getElementById("access-form");
const accessPasswordInput = document.getElementById("student-password");
const accessError = document.getElementById("access-error");
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
let modalAfterCloseAction = null;
let supabaseClient = null;

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase("pt-BR");
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
    throw new Error("Biblioteca do Supabase não carregou. Verifique sua conexão e recarregue a página.");
  }

  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    throw new Error("Configuração do Supabase ausente. Preencha SUPABASE_URL e SUPABASE_ANON_KEY em config.js.");
  }

  supabaseClient = window.supabase.createClient(url, anonKey);
  return supabaseClient;
}

function allowedRolesForClassroom(classroom) {
  if (classroom.startsWith("1° ano")) {
    return ["Assessor", "Deputado", "Staff"];
  }

  if (classroom.startsWith("2° ano") || classroom.startsWith("3° ano")) {
    return ["Assessor", "Deputado", "Imprensa"];
  }

  return ["Assessor", "Deputado"];
}

function switchScreen(target) {
  accessScreen.classList.add("hidden");
  studentScreen.classList.add("hidden");
  changeScreen.classList.add("hidden");
  roleScreen.classList.add("hidden");
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
  flowMode = null;
  currentRegistration = null;
  accessError.classList.add("hidden");
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
    option.textContent = isUnavailable ? `${option.value} (indisponível)` : option.value;
  });
}

function populateRegisteredStudents() {
  const selected = registeredStudentNameSelect.value;
  const placeholder = '<option value="">Selecione o aluno</option>';

  const sorted = [...statusData.registeredEntries].sort((a, b) =>
    a.studentName.localeCompare(b.studentName, "pt-BR", { sensitivity: "base" })
  );

  registeredStudentNameSelect.innerHTML =
    placeholder +
    sorted.map((entry) => `<option value="${entry.studentName}">${entry.studentName}</option>`).join("");

  if (selected) {
    registeredStudentNameSelect.value = selected;
  }
}

function renderRoleOptions(classroom) {
  const allowedRoles = allowedRolesForClassroom(classroom);
  roleSelect.innerHTML = '<option value="">Selecione o cargo</option>';

  ROLE_ORDER.forEach((role) => {
    if (!allowedRoles.includes(role)) {
      return;
    }

    const remaining = Number(statusData.vacancies[role] || 0);
    const option = document.createElement("option");
    option.value = role;

    if (remaining <= 0) {
      option.disabled = true;
      option.textContent = `${role} (indisponível)`;
    } else {
      option.textContent = `${role} (${remaining} vaga${remaining === 1 ? "" : "s"})`;
    }

    roleSelect.appendChild(option);
  });

  roleHint.textContent =
    classroom.startsWith("1° ano")
      ? "Para turmas de 1° ano, o cargo Imprensa não é permitido."
      : "Para turmas de 2°/3° ano, o cargo Staff não é permitido.";
}

function applyStatus(status) {
  statusData = {
    vacancies: status?.vacancies || {},
    registeredStudents: status?.registeredStudents || [],
    registeredEmails: status?.registeredEmails || [],
    registeredEntries: status?.registeredEntries || [],
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
    throw new Error(error.message || "Falha ao executar operação no Supabase.");
  }

  return data;
}

async function startFlow(mode) {
  try {
    getSupabaseClient();
  } catch (error) {
    openModal("error", "Configuração pendente", error.message);
    return;
  }

  if (accessPasswordInput.value !== APP_PASSWORD) {
    accessError.classList.remove("hidden");
    return;
  }

  accessError.classList.add("hidden");

  try {
    await fetchStatus();
    flowMode = mode;

    if (mode === "new") {
      switchScreen(studentScreen);
      return;
    }

    switchScreen(changeScreen);
  } catch (error) {
    openModal("error", "Erro", error.message || "Não foi possível carregar os dados.");
  }
}

newRegistrationButton.addEventListener("click", () => startFlow("new"));
changeRegistrationButton.addEventListener("click", () => startFlow("change"));

accessForm.addEventListener("submit", (event) => {
  event.preventDefault();
  startFlow("new");
});

studentForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const classroom = classroomSelect.value.trim();
  const studentName = studentNameSelect.value.trim();
  const email = emailInput.value.trim();

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
    openModal("error", "E-mail já cadastrado", "Este e-mail já foi utilizado. Use outro e-mail para continuar.");
    return;
  }

  currentRegistration = { classroom, studentName, email };
  roleSubtitle.textContent = "Etapa 2: Escolha do cargo";
  studentSummary.textContent = `Turma: ${classroom} | Aluno: ${studentName} | E-mail: ${email}`;
  renderRoleOptions(classroom);
  switchScreen(roleScreen);
});

changeForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const studentName = registeredStudentNameSelect.value.trim();
  const email = registeredEmailInput.value.trim();

  if (!studentName || !email) {
    openModal("error", "Dados incompletos", "Selecione o aluno e informe o e-mail já cadastrado.");
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
  };

  roleSubtitle.textContent = "Etapa 2: Escolha o novo cargo";
  studentSummary.textContent = `Turma: ${entry.classroom} | Aluno: ${entry.studentName} | Cargo atual: ${entry.role}`;
  renderRoleOptions(entry.classroom);
  switchScreen(roleScreen);
});

roleForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentRegistration || !flowMode) {
    openModal("error", "Fluxo inválido", "Refaça o processo a partir da tela inicial.");
    resetToAccessScreen();
    return;
  }

  const role = roleSelect.value.trim();
  if (!role) {
    openModal("error", "Cargo obrigatório", "Selecione um cargo para finalizar.");
    return;
  }

  const rpcName = flowMode === "new" ? "app_new_registration" : "app_change_registration";

  try {
    const result = await callAction(rpcName, {
      p_classroom: currentRegistration.classroom,
      p_student_name: currentRegistration.studentName,
      p_email: currentRegistration.email,
      p_role: role,
    });

    applyStatus(result.status);

    if (!result.ok) {
      if (result.code === "EMAIL_EXISTS") {
        openModal("error", "E-mail já cadastrado", "Este e-mail já foi utilizado. Use outro e-mail para continuar.");
      } else if (result.code === "STUDENT_EXISTS") {
        openModal("error", "Aluno indisponível", "Esse aluno já foi cadastrado e não pode ser selecionado novamente.");
      } else if (result.code === "EMAIL_MISMATCH") {
        openModal("error", "E-mail divergente", "O e-mail informado não corresponde ao cadastro do aluno.");
      } else {
        openModal("error", "Erro no cadastro", result.message || "Não foi possível concluir a operação.");
      }
      return;
    }

    const successTitle = flowMode === "new" ? "Cadastro realizado com sucesso!" : "Mudança de cadastro concluída!";
    const successMessage =
      flowMode === "new"
        ? `Cargo: ${role}. Vagas restantes neste cargo: ${result.remainingForRole}.`
        : `Cargo alterado para ${role}. Vagas restantes neste cargo: ${result.remainingForRole}.`;

    openModal("success", successTitle, successMessage, resetToAccessScreen);
  } catch (error) {
    openModal("error", "Erro", error.message || "Não foi possível comunicar com o Supabase.");
  }
});

backToPreviousButton.addEventListener("click", () => {
  if (flowMode === "change") {
    switchScreen(changeScreen);
    return;
  }

  switchScreen(studentScreen);
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

modal.classList.add("hidden");
switchScreen(accessScreen);


