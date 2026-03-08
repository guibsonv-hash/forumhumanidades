const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = "127.0.0.1";
const PORT = 3000;
const STUDENT_PASSWORD = "univap.humanidades";
const ROLE_LIMITS = {
  Assessor: 10,
  Deputado: 10,
  Imprensa: 10,
  Staff: 10,
};

const ROOT_DIR = __dirname;
const LOG_DIR = path.join(ROOT_DIR, "logs");
const LOG_FILE = path.join(LOG_DIR, "cadastros_forum_humanidades_2026.csv");

function ensureLogFile() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, "turma;nome;cargo;email;data;hora\n", "utf8");
  }
}

function sanitize(value) {
  return String(value || "").replace(/;/g, ",").replace(/\r?\n/g, " ").trim();
}

function normalize(value) {
  return sanitize(value).toLocaleLowerCase("pt-BR");
}

function getLogRows() {
  ensureLogFile();
  const content = fs.readFileSync(LOG_FILE, "utf8").trim();
  if (!content) {
    return [];
  }

  const lines = content.split(/\r?\n/).slice(1).filter(Boolean);
  return lines.map((line) => {
    const [classroom, studentName, role, email, date, time] = line.split(";");
    return {
      classroom: sanitize(classroom),
      studentName: sanitize(studentName),
      role: sanitize(role),
      email: sanitize(email),
      date: sanitize(date),
      time: sanitize(time),
    };
  });
}

function writeLogRows(rows) {
  ensureLogFile();
  const header = "turma;nome;cargo;email;data;hora\n";
  const body = rows
    .map((row) => `${row.classroom};${row.studentName};${row.role};${row.email};${row.date};${row.time}`)
    .join("\n");

  fs.writeFileSync(LOG_FILE, body ? header + body + "\n" : header, "utf8");
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

function getVacanciesFromRows(rows) {
  const usedByRole = Object.fromEntries(Object.keys(ROLE_LIMITS).map((role) => [role, 0]));

  rows.forEach((row) => {
    if (Object.prototype.hasOwnProperty.call(usedByRole, row.role)) {
      usedByRole[row.role] += 1;
    }
  });

  return Object.fromEntries(
    Object.entries(ROLE_LIMITS).map(([role, limit]) => [role, Math.max(limit - usedByRole[role], 0)])
  );
}

function getSystemStatus(rows = null) {
  const list = rows || getLogRows();
  const vacancies = getVacanciesFromRows(list);

  const registeredStudents = list.map((row) => row.studentName).filter(Boolean);
  const registeredEmails = list.map((row) => row.email).filter(Boolean);
  const registeredEntries = list.map((row) => ({
    classroom: row.classroom,
    studentName: row.studentName,
    email: row.email,
    role: row.role,
  }));

  return {
    vacancies,
    registeredStudents,
    registeredEmails,
    registeredEntries,
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
  };
  return map[ext] || "application/octet-stream";
}

function handleStatic(req, res) {
  const pathname = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.join(ROOT_DIR, pathname.replace(/^\//, ""));

  if (!filePath.startsWith(ROOT_DIR)) {
    sendJson(res, 403, { message: "Acesso negado." });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { message: "Arquivo não encontrado." });
      return;
    }

    res.writeHead(200, { "Content-Type": getContentType(filePath) });
    res.end(data);
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(new Error("Payload muito grande."));
      }
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("JSON inválido."));
      }
    });

    req.on("error", reject);
  });
}

function validatePassword(password, res) {
  if (String(password || "") !== STUDENT_PASSWORD) {
    sendJson(res, 401, { message: "Senha de aluno inválida." });
    return false;
  }

  return true;
}

function validateRoleForClassroom(classroom, role) {
  const allowed = allowedRolesForClassroom(classroom);
  return allowed.includes(role);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/api/status" || req.url === "/api/vacancies")) {
    sendJson(res, 200, getSystemStatus());
    return;
  }

  if (req.method === "POST" && req.url === "/api/register") {
    try {
      const body = await parseBody(req);
      if (!validatePassword(body.password, res)) {
        return;
      }

      const classroom = sanitize(body.classroom);
      const studentName = sanitize(body.studentName);
      const role = sanitize(body.role);
      const email = sanitize(body.email);

      if (!classroom || !studentName || !role || !email) {
        sendJson(res, 400, { message: "Preencha turma, nome, cargo e e-mail." });
        return;
      }

      if (!Object.prototype.hasOwnProperty.call(ROLE_LIMITS, role)) {
        sendJson(res, 400, { message: "Cargo inválido." });
        return;
      }

      if (!validateRoleForClassroom(classroom, role)) {
        sendJson(res, 400, {
          message: "Cargo não permitido para a turma selecionada.",
          code: "ROLE_NOT_ALLOWED",
          ...getSystemStatus(),
        });
        return;
      }

      const rows = getLogRows();
      const status = getSystemStatus(rows);

      const studentExists = status.registeredStudents.some((name) => normalize(name) === normalize(studentName));
      if (studentExists) {
        sendJson(res, 409, { message: "Aluno já cadastrado.", code: "STUDENT_EXISTS", ...status });
        return;
      }

      const emailExists = status.registeredEmails.some((value) => normalize(value) === normalize(email));
      if (emailExists) {
        sendJson(res, 409, { message: "E-mail já cadastrado.", code: "EMAIL_EXISTS", ...status });
        return;
      }

      if ((status.vacancies[role] || 0) <= 0) {
        sendJson(res, 409, { message: "Esse cargo não possui vagas.", code: "NO_VACANCY", ...status });
        return;
      }

      const now = new Date();
      const date = now.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const time = now.toLocaleTimeString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      rows.push({ classroom, studentName, role, email, date, time });
      writeLogRows(rows);

      const updatedStatus = getSystemStatus(rows);
      sendJson(res, 201, {
        message: "Cadastro realizado com sucesso.",
        remainingForRole: updatedStatus.vacancies[role],
        ...updatedStatus,
      });
    } catch (error) {
      sendJson(res, 400, { message: error.message || "Erro ao processar cadastro." });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/change-role") {
    try {
      const body = await parseBody(req);
      if (!validatePassword(body.password, res)) {
        return;
      }

      const studentName = sanitize(body.studentName);
      const email = sanitize(body.email);
      const newRole = sanitize(body.role);

      if (!studentName || !email || !newRole) {
        sendJson(res, 400, { message: "Informe aluno, e-mail e novo cargo." });
        return;
      }

      if (!Object.prototype.hasOwnProperty.call(ROLE_LIMITS, newRole)) {
        sendJson(res, 400, { message: "Cargo inválido." });
        return;
      }

      const rows = getLogRows();
      const index = rows.findIndex(
        (row) => normalize(row.studentName) === normalize(studentName)
      );

      if (index < 0) {
        sendJson(res, 404, {
          message: "Aluno não encontrado no cadastro.",
          code: "RECORD_NOT_FOUND",
          ...getSystemStatus(rows),
        });
        return;
      }

      const current = rows[index];
      if (normalize(current.email) !== normalize(email)) {
        sendJson(res, 409, {
          message: "E-mail divergente para o aluno informado.",
          code: "EMAIL_MISMATCH",
          ...getSystemStatus(rows),
        });
        return;
      }

      if (!validateRoleForClassroom(current.classroom, newRole)) {
        sendJson(res, 400, {
          message: "Cargo não permitido para a turma do aluno.",
          code: "ROLE_NOT_ALLOWED",
          ...getSystemStatus(rows),
        });
        return;
      }

      if (current.role === newRole) {
        const sameStatus = getSystemStatus(rows);
        sendJson(res, 200, {
          message: "Cargo já era o selecionado.",
          remainingForRole: sameStatus.vacancies[newRole],
          ...sameStatus,
        });
        return;
      }
      const currentStatus = getSystemStatus(rows);
      if ((currentStatus.vacancies[newRole] || 0) <= 0) {
        sendJson(res, 409, {
          message: "N?o h? vagas para o novo cargo selecionado.",
          code: "NO_VACANCY",
          ...currentStatus,
        });
        return;
      }

      rows[index] = { ...current, role: newRole };
      writeLogRows(rows);

      const updatedStatus = getSystemStatus(rows);
      sendJson(res, 200, {
        message: "Cadastro alterado com sucesso.",
        remainingForRole: updatedStatus.vacancies[newRole],
        ...updatedStatus,
      });
    } catch (error) {
      sendJson(res, 400, { message: error.message || "Erro ao alterar cadastro." });
    }
    return;
  }

  handleStatic(req, res);
});

server.listen(PORT, HOST, () => {
  ensureLogFile();
  console.log(`Servidor rodando em http://${HOST}:${PORT}`);
  console.log(`Log de cadastros: ${LOG_FILE}`);
});
