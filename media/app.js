(() => {
  const vscode = acquireVsCodeApi();
  const pending = new Map();
  let nextId = 0;
  const state = {
    tab: "flows",
    flows: [],
    runs: [],
    schedules: [],
    listeners: [],
    listenerSources: [],
    environments: [],
    errors: [],
    selectedFlow: null,
    detail: null,
    dashboard: null,
    dashboardTimer: null
  };
  const app = document.getElementById("app");

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function request(path, method = "GET", body) {
    return new Promise((resolve, reject) => {
      const id = String(++nextId);
      pending.set(id, { resolve, reject });
      vscode.postMessage({ type: "request", id, path, method, body });
      setTimeout(() => {
        const request = pending.get(id);
        if (request) {
          pending.delete(id);
          reject(new Error("Code Flow request timed out."));
        }
      }, 25000);
    });
  }

  window.addEventListener("message", event => {
    const message = event.data;
    if (message.type !== "response" || !pending.has(message.id)) return;
    const current = pending.get(message.id);
    pending.delete(message.id);
    if (message.ok) current.resolve(message.data);
    else {
      const detail = message.data?.detail;
      current.reject(new Error(detail ? JSON.stringify(detail) : message.error || `HTTP ${message.status}`));
    }
  });

  async function loadAll() {
    state.errors = [];
    try {
      const results = await Promise.allSettled([
        request("/api/flows"),
        request("/api/environments"),
        request("/api/runs"),
        request("/api/schedules"),
        request("/api/listeners")
      ]);
      const [flows, environments, runs, schedules, listeners] = results;
      if (flows.status === "fulfilled") {
        state.flows = flows.value.flows || [];
        state.errors.push(...(flows.value.errors || []).map(item => `${item.file}: ${item.error}`));
      } else state.errors.push(flows.reason.message);
      if (environments.status === "fulfilled") {
        state.environments = environments.value.environments || [];
        state.errors.push(...(environments.value.errors || []).map(item => `${item.file}: ${item.error}`));
      } else state.errors.push(environments.reason.message);
      if (runs.status === "fulfilled") state.runs = runs.value.runs || [];
      else state.errors.push(runs.reason.message);
      if (schedules.status === "fulfilled") state.schedules = schedules.value.schedules || [];
      else state.errors.push(schedules.reason.message);
      if (listeners.status === "fulfilled") {
        state.listeners = listeners.value.listeners || [];
        state.listenerSources = listeners.value.sources || [];
      } else state.errors.push(listeners.reason.message);
      render();
    } catch (error) {
      state.errors.push(error.message);
      render();
    }
  }

  function render() {
    const nav = ["flows", "dashboards", "history", "schedules", "listeners", "environments"];
    app.innerHTML = `
      <header>
        <div class="brand"><span class="brand-mark">CF</span><div><strong>Code Flow</strong><small>Python workflow control</small></div></div>
        <div class="header-actions">
          <button data-action="refresh" title="Refresh">↻ Refresh</button>
          <button data-action="configure">Server settings</button>
          <button class="primary" data-action="create-workflow">+ Python workflow</button>
        </div>
      </header>
      <nav>${nav.map(tab => `<button class="${state.tab === tab ? "active" : ""}" data-tab="${tab}">${tab[0].toUpperCase() + tab.slice(1)}${tab === "history" ? `<span class="badge">${state.runs.filter(run => run.status === "RUNNING").length || ""}</span>` : ""}</button>`).join("")}</nav>
      ${state.errors.length ? `<div class="notice">${state.errors.map(error => `<div>${escapeHtml(error)}</div>`).join("")}</div>` : ""}
      <main>${renderPage()}</main>
      <div id="modal-root"></div>
      <div id="toast" role="status"></div>`;
  }

  function renderPage() {
    if (state.tab === "flows") return renderFlows();
    if (state.tab === "dashboards") return renderDashboards();
    if (state.tab === "history") return renderHistory();
    if (state.tab === "schedules") return renderSchedules();
    if (state.tab === "listeners") return renderListeners();
    return renderEnvironments();
  }

  function renderFlows() {
    const flow = state.selectedFlow && state.flows.find(item => item.name === state.selectedFlow);
    if (flow) {
      return `<div class="section-head"><button data-action="back-flows">← Workflows</button><span class="spacer"></span><button class="primary" data-action="run-flow" data-name="${escapeHtml(flow.name)}">▶ Run</button></div>
        <section class="panel"><h1>${escapeHtml(flow.name)}</h1><p>${escapeHtml(flow.description || "No description")}</p>
        <div class="chips">${(flow.tags || []).map(tag => `<span class="chip">${escapeHtml(tag)}</span>`).join("")}<span class="chip">${escapeHtml(flow.file)}</span></div></section>
        <section class="panel"><h2>Inputs</h2><pre>${escapeHtml(JSON.stringify(flow.inputs || {}, null, 2))}</pre>${flow.inputs_error ? `<p class="error">${escapeHtml(flow.inputs_error)}</p>` : ""}</section>
        <section class="panel"><h2>Steps</h2>${(flow.steps || []).length ? `<ul class="step-list">${flow.steps.map(step => `<li><strong>${escapeHtml(step.name)}</strong><span>retry ${step.retry || 0}${step.timeout ? ` · timeout ${step.timeout}s` : ""}</span>${step.doc ? `<p>${escapeHtml(step.doc)}</p>` : ""}</li>`).join("")}</ul>` : `<p class="muted">No step metadata.</p>`}</section>
        <section class="panel"><h2>Python entry point</h2><pre>${escapeHtml(flow.source || "Source unavailable")}</pre></section>`;
    }
    return `<div class="section-head"><div><h1>Workflows</h1><p>Browse and start Python workflows discovered by the Code Flow server.</p></div></div>
      <div class="card-grid">${state.flows.length ? state.flows.map(flow => `<article class="card">
        <div class="card-title"><h2>${escapeHtml(flow.name)}</h2>${flow.dashboard ? `<span class="chip">Dashboard</span>` : ""}</div>
        <p>${escapeHtml(flow.description || "No description")}</p><small>${escapeHtml(flow.file)}</small>
        <div class="chips">${(flow.tags || []).map(tag => `<span class="chip">${escapeHtml(tag)}</span>`).join("")}</div>
        <div class="card-actions"><button data-action="flow-detail" data-name="${escapeHtml(flow.name)}">Details</button><button class="primary" data-action="run-flow" data-name="${escapeHtml(flow.name)}">▶ Run</button></div>
      </article>`).join("") : `<div class="empty">No workflows found. Add Python files under your configured workflows folder.</div>`}</div>`;
  }

  function renderDashboards() {
    if (state.dashboard) {
      const flow = state.flows.find(item => item.name === state.dashboard.name);
      const data = state.dashboard.data;
      return `<div class="section-head"><button data-action="back-dashboards">← Dashboards</button><h1>${escapeHtml(state.dashboard.name)}</h1><span class="spacer"></span><select id="dash-env">${environmentOptions(state.dashboard.env)}</select><button data-action="dashboard-refresh" class="primary">Refresh</button></div>
        <section class="panel compact"><label>Inputs (JSON)<textarea id="dash-inputs" rows="3">${escapeHtml(JSON.stringify(state.dashboard.inputs ?? flow?.inputs ?? {}, null, 2))}</textarea></label><label>Auto refresh<select id="dash-auto"><option value="0" ${!state.dashboard.autoRefresh ? "selected" : ""}>Off</option><option value="10" ${state.dashboard.autoRefresh === 10 ? "selected" : ""}>10 seconds</option><option value="30" ${state.dashboard.autoRefresh === 30 ? "selected" : ""}>30 seconds</option><option value="60" ${state.dashboard.autoRefresh === 60 ? "selected" : ""}>1 minute</option></select></label></section>
        ${data?.error ? `<div class="notice error">${escapeHtml(data.error)}</div>` : ""}
        <div class="widget-grid">${(data?.widgets || []).map(widget => renderWidget(widget)).join("") || `<div class="empty">No widgets returned by this dashboard.</div>`}</div>
        <p class="muted">${data ? `${escapeHtml(data.status)} · ${escapeHtml(data.duration_ms)} ms` : "Refresh to load dashboard data."}</p>`;
    }
    const dashboards = state.flows.filter(flow => flow.dashboard);
    return `<div class="section-head"><div><h1>Dashboards</h1><p>Open workflows marked with <code>dashboard = True</code>.</p></div></div>
      <div class="card-grid">${dashboards.length ? dashboards.map(flow => `<article class="card"><h2>${escapeHtml(flow.name)}</h2><p>${escapeHtml(flow.description || "")}</p><small>${escapeHtml(flow.file)}</small><div class="card-actions"><button class="primary" data-action="dashboard-open" data-name="${escapeHtml(flow.name)}">Open dashboard</button></div></article>`).join("") : `<div class="empty">No dashboards found.</div>`}</div>`;
  }

  function renderWidget(widget) {
    const title = escapeHtml(widget.title || widget.type || "Widget");
    let value;
    if (widget.type === "metric" || widget.type === "stat" || widget.type === "status" || widget.type === "progress") {
      value = `<strong class="metric">${escapeHtml(widget.value ?? widget.status ?? widget.progress ?? "")}</strong>`;
    } else if (widget.type === "table") {
      value = `<pre>${escapeHtml(JSON.stringify(widget.data ?? widget.value ?? {}, null, 2))}</pre>`;
    } else if (widget.type === "chart") {
      value = `<pre>${escapeHtml(JSON.stringify(widget.data ?? {}, null, 2))}</pre><small>${escapeHtml(widget.chart || "chart")}</small>`;
    } else {
      value = `<pre>${escapeHtml(typeof widget.value === "string" ? widget.value : JSON.stringify(widget.value ?? widget.data ?? widget, null, 2))}</pre>`;
    }
    return `<article class="widget ${escapeHtml(widget.size || "")}"><h3>${title}</h3>${value}</article>`;
  }

  function renderHistory() {
    return `<div class="section-head"><div><h1>Run history</h1><p>${state.runs.length} recent runs · ${state.runs.filter(run => run.status === "RUNNING").length} running</p></div><button data-action="clear-history" class="danger">Clear finished runs</button></div>
      <div class="filters"><input id="history-search" type="search" placeholder="Filter by workflow, status, or run ID"><select id="history-status"><option value="">All statuses</option>${["RUNNING", "SUCCESS", "FAILED", "CANCELLED", "INTERRUPTED"].map(status => `<option>${status}</option>`).join("")}</select></div>
      <div class="table-wrap"><table><thead><tr><th>Workflow</th><th>Status</th><th>Started</th><th>Duration</th><th>Environment</th><th></th></tr></thead><tbody id="history-rows">${renderRunRows(state.runs)}</tbody></table></div>`;
  }

  function renderRunRows(runs) {
    if (!runs.length) return `<tr><td colspan="6" class="empty">No runs match this filter.</td></tr>`;
    return runs.map(run => `<tr><td><strong>${escapeHtml(run.workflow)}</strong><small class="block">${escapeHtml(run.run_id)}</small></td><td><span class="status ${escapeHtml(String(run.status).toLowerCase())}">${escapeHtml(run.status)}</span></td><td>${escapeHtml(run.started_at || "—")}</td><td>${escapeHtml(formatDuration(run.duration_ms))}</td><td>${escapeHtml(run.environment || "—")}</td><td><button data-action="run-detail" data-id="${escapeHtml(run.run_id)}">Open</button></td></tr>`).join("");
  }

  function renderSchedules() {
    return `<div class="section-head"><div><h1>Schedules</h1><p>Manage recurring Code Flow runs.</p></div><button class="primary" data-action="new-schedule">+ New schedule</button></div>
      <div class="card-grid">${state.schedules.length ? state.schedules.map(schedule => `<article class="card">
        <div class="card-title"><h2>${escapeHtml(schedule.flow)}</h2><label class="toggle"><input type="checkbox" data-action="schedule-toggle" data-id="${escapeHtml(schedule.id)}" ${schedule.enabled ? "checked" : ""}> enabled</label></div>
        <p>${escapeHtml(schedule.when || schedule.type)} ${schedule.env ? `· ${escapeHtml(schedule.env)}` : ""}</p><small>Next: ${escapeHtml(schedule.enabled ? schedule.next_run_at || "—" : "disabled")}</small>
        ${schedule.last_error ? `<p class="error">${escapeHtml(schedule.last_error)}</p>` : ""}
        <div class="card-actions"><button data-action="schedule-run" data-id="${escapeHtml(schedule.id)}">Run now</button><button class="danger" data-action="schedule-delete" data-id="${escapeHtml(schedule.id)}">Delete</button>${schedule.last_run_id ? `<button data-action="open-report" data-id="${escapeHtml(schedule.last_run_id)}">Last report</button>` : ""}</div>
      </article>`).join("") : `<div class="empty">No schedules yet. Create one to run a workflow on an interval or daily schedule.</div>`}</div>`;
  }

  function renderListeners() {
    return `<div class="section-head"><div><h1>Listeners</h1><p>Start workflows when broker messages arrive. Test injection does not require a broker.</p></div><button class="primary" data-action="new-listener">+ New listener</button></div>
      <div class="card-grid">${state.listeners.length ? state.listeners.map(listener => {
        const status = listener.status || {};
        const config = listener.config || {};
        const endpoint = config.host || [].concat(config.bootstrap_servers || []).join(", ");
        const topics = [].concat(config.topics || []).join(", ");
        return `<article class="card">
          <div class="card-title"><h2>${escapeHtml(listener.name)}</h2><label class="toggle"><input type="checkbox" data-action="listener-toggle" data-id="${escapeHtml(listener.id)}" ${listener.enabled ? "checked" : ""}> enabled</label></div>
          <p>${escapeHtml(listener.flow)} · ${escapeHtml(listener.type)}${listener.env ? ` · ${escapeHtml(listener.env)}` : ""}</p>
          <small>${escapeHtml([endpoint, topics].filter(Boolean).join(" · ") || "No broker address")}</small>
          <div class="chips"><span class="chip">${escapeHtml(status.state || "stopped")}</span><span class="chip">received ${escapeHtml(status.messages || 0)}</span><span class="chip">launched ${escapeHtml(status.launched || 0)}</span><span class="chip">filtered ${escapeHtml(status.filtered || 0)}</span><span class="chip">dropped ${escapeHtml(status.dropped || 0)}</span></div>
          ${status.last_error ? `<p class="error">${escapeHtml(status.last_error)}</p>` : ""}
          <div class="card-actions"><button data-action="listener-test" data-id="${escapeHtml(listener.id)}">Send test message</button><button class="danger" data-action="listener-delete" data-id="${escapeHtml(listener.id)}">Delete</button>${status.last_run_id ? `<button data-action="open-report" data-id="${escapeHtml(status.last_run_id)}">Last report</button>` : ""}</div>
        </article>`;
      }).join("") : `<div class="empty">No listeners configured. Add a broker listener to trigger workflows from messages.</div>`}</div>
      ${state.listenerSources.some(source => !source.available) ? `<section class="panel"><h2>Unavailable sources</h2>${state.listenerSources.filter(source => !source.available).map(source => `<p><strong>${escapeHtml(source.label || source.name)}</strong>: ${escapeHtml(source.unavailable_reason)} · install <code>${escapeHtml(source.install)}</code></p>`).join("")}</section>` : ""}`;
  }

  function renderEnvironments() {
    return `<div class="section-head"><div><h1>Environments</h1><p>Values are returned masked by the server; edit environment files on the server to change them.</p></div></div>
      <div class="card-grid">${state.environments.length ? state.environments.map(environment => `<article class="card"><h2>${escapeHtml(environment.name)}</h2><pre>${escapeHtml(JSON.stringify(environment.values || {}, null, 2))}</pre></article>`).join("") : `<div class="empty">No environments configured.</div>`}</div>`;
  }

  function environmentOptions(selected = "") {
    return `<option value="">No environment</option>${state.environments.map(env => `<option value="${escapeHtml(env.name)}" ${selected === env.name ? "selected" : ""}>${escapeHtml(env.name)}</option>`).join("")}`;
  }

  function showModal(title, content, submitLabel, onSubmit) {
    const root = document.getElementById("modal-root");
    root.innerHTML = `<div class="modal-backdrop"><section class="modal"><div class="modal-head"><h2>${escapeHtml(title)}</h2><button data-action="modal-close">×</button></div><div class="modal-content">${content}</div><div class="modal-actions"><button data-action="modal-close">Cancel</button><button id="modal-submit" class="primary">${escapeHtml(submitLabel)}</button></div></section></div>`;
    document.getElementById("modal-submit").addEventListener("click", onSubmit);
  }

  function openRunModal(name) {
    const flow = state.flows.find(item => item.name === name);
    if (!flow) return;
    showModal(`Run ${name}`, `<label>Environment<select id="run-env">${environmentOptions()}</select></label><label>Inputs (JSON)<textarea id="run-inputs" rows="10">${escapeHtml(JSON.stringify(flow.inputs || {}, null, 2))}</textarea></label><div id="modal-error" class="error"></div>`, "Start run", async () => {
      try {
        const inputs = parseJsonField("run-inputs");
        const result = await request(`/api/run/${encodeURIComponent(name)}`, "POST", { inputs, env: document.getElementById("run-env").value || null });
        closeModal();
        toast(`Started ${result.run_id}`);
        state.tab = "history";
        await loadAll();
      } catch (error) { modalError(error); }
    });
  }

  function openScheduleModal() {
    if (!state.flows.length) return toast("No workflows are available to schedule.");
    showModal("New schedule", `<label>Workflow<select id="schedule-flow">${state.flows.map(flow => `<option value="${escapeHtml(flow.name)}">${escapeHtml(flow.name)}</option>`).join("")}</select></label>
      <label>Schedule type<select id="schedule-type"><option value="interval">Interval</option><option value="daily">Daily</option></select></label>
      <label id="interval-field">Every (minutes)<input id="schedule-minutes" type="number" min="1" value="60"></label>
      <label id="daily-field" class="hidden">Time<input id="schedule-time" type="time" value="07:00"></label>
      <fieldset id="days-field" class="hidden"><legend>Days (empty means every day)</legend>${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, index) => `<label class="day"><input type="checkbox" value="${index}">${day}</label>`).join("")}</fieldset>
      <label>Environment<select id="schedule-env">${environmentOptions()}</select></label>
      <label>Inputs (JSON)<textarea id="schedule-inputs" rows="5">${escapeHtml(JSON.stringify(state.flows[0].inputs || {}, null, 2))}</textarea></label><div id="modal-error" class="error"></div>`, "Create schedule", async () => {
      try {
        const type = document.getElementById("schedule-type").value;
        const body = {
          flow: document.getElementById("schedule-flow").value,
          type,
          inputs: parseJsonField("schedule-inputs"),
          env: document.getElementById("schedule-env").value || null
        };
        if (type === "interval") body.every_minutes = Number(document.getElementById("schedule-minutes").value);
        else {
          body.time = document.getElementById("schedule-time").value;
          body.days = [...document.querySelectorAll("#days-field input:checked")].map(input => Number(input.value));
        }
        await request("/api/schedules", "POST", body);
        closeModal();
        toast("Schedule created.");
        await loadAll();
      } catch (error) { modalError(error); }
    });
    document.getElementById("schedule-type").addEventListener("change", event => {
      const daily = event.target.value === "daily";
      document.getElementById("interval-field").classList.toggle("hidden", daily);
      document.getElementById("daily-field").classList.toggle("hidden", !daily);
      document.getElementById("days-field").classList.toggle("hidden", !daily);
    });
    document.getElementById("schedule-flow").addEventListener("change", event => {
      const flow = state.flows.find(item => item.name === event.target.value);
      document.getElementById("schedule-inputs").value = JSON.stringify(flow?.inputs || {}, null, 2);
    });
  }

  function sourceFieldsHtml(source) {
    if (!source) return "";
    return `${!source.available ? `<p class="error">${escapeHtml(source.unavailable_reason)} · install ${escapeHtml(source.install)}</p>` : ""}
      ${(source.fields || []).map(field => {
        const id = `source-${field.key}`;
        const value = field.default ?? "";
        let control;
        if (field.options) {
          control = `<select id="${escapeHtml(id)}">${field.required ? "" : `<option value=""></option>`}${field.options.map(option => `<option value="${escapeHtml(option)}" ${String(option) === String(value) ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
        } else if (field.type === "boolean") {
          control = `<input type="checkbox" id="${escapeHtml(id)}" ${value ? "checked" : ""}>`;
        } else if (field.type === "integer" || field.type === "number") {
          control = `<input type="number" id="${escapeHtml(id)}" value="${escapeHtml(value)}">`;
        } else {
          control = `<input type="${field.secret ? "password" : "text"}" id="${escapeHtml(id)}" value="${escapeHtml(Array.isArray(value) ? value.join(", ") : value)}" ${field.type === "list" ? `placeholder="comma-separated"` : ""}>`;
        }
        return `<label>${escapeHtml(field.label || field.key)}${field.required ? " *" : ""}${control}${field.help ? `<small>${escapeHtml(field.help)}</small>` : ""}</label>`;
      }).join("")}`;
  }

  function openListenerModal() {
    if (!state.listenerSources.length) return toast("No listener sources are available.");
    if (!state.flows.length) return toast("No workflows are available to attach to a listener.");
    const sourceOptions = state.listenerSources.map(source => `<option value="${escapeHtml(source.name)}">${escapeHtml(source.label || source.name)}${source.available ? "" : " (library not installed)"}</option>`).join("");
    showModal("New listener", `<label>Name<input id="listener-name" required placeholder="e.g. sensor events"></label>
      <label>Source<select id="listener-type">${sourceOptions}</select></label><div id="listener-config">${sourceFieldsHtml(state.listenerSources[0])}</div>
      <label>Workflow<select id="listener-flow">${state.flows.map(flow => `<option value="${escapeHtml(flow.name)}">${escapeHtml(flow.name)}</option>`).join("")}</select></label>
      <label>Environment<select id="listener-env">${environmentOptions()}</select></label>
      <label>Payload mapping<select id="listener-mode"><option value="envelope">Envelope only</option><option value="merge">Merge object payload into inputs</option></select></label>
      <label>Max in-flight runs<input id="listener-max" type="number" min="1" value="10"></label>
      <label>Static inputs (JSON)<textarea id="listener-inputs" rows="3">{}</textarea></label>
      <label>Filter (JSON)<textarea id="listener-filter" rows="3">{}</textarea></label><div id="modal-error" class="error"></div>`, "Create listener", async () => {
      try {
        const source = state.listenerSources.find(item => item.name === document.getElementById("listener-type").value);
        const config = {};
        for (const field of source?.fields || []) {
          const element = document.getElementById(`source-${field.key}`);
          if (!element) continue;
          let value = field.type === "boolean" ? element.checked : element.value;
          if (value === "" || value === null) continue;
          if (field.type === "list") value = value.split(",").map(item => item.trim()).filter(Boolean);
          if (field.type === "integer") value = Number.parseInt(value, 10);
          if (field.type === "number") value = Number(value);
          config[field.key] = value;
        }
        const result = await request("/api/listeners", "POST", {
          name: document.getElementById("listener-name").value,
          type: source?.name,
          flow: document.getElementById("listener-flow").value,
          env: document.getElementById("listener-env").value || null,
          payload_mode: document.getElementById("listener-mode").value,
          max_in_flight: Number(document.getElementById("listener-max").value) || 10,
          inputs: parseJsonField("listener-inputs"),
          filter: parseJsonField("listener-filter"),
          config
        });
        closeModal(); toast(`Listener created: ${result.name}`); await loadAll();
      } catch (error) { modalError(error); }
    });
    document.getElementById("listener-type").addEventListener("change", event => {
      const source = state.listenerSources.find(item => item.name === event.target.value);
      document.getElementById("listener-config").innerHTML = sourceFieldsHtml(source);
    });
  }

  function openListenerTest(id) {
    showModal("Send test message", `<label>Topic (optional)<input id="listener-test-topic"></label><label>Payload (JSON)<textarea id="listener-test-payload" rows="6">{}</textarea></label><div id="modal-error" class="error"></div><div id="listener-test-result"></div>`, "Send", async () => {
      try {
        const result = await request(`/api/listeners/${encodeURIComponent(id)}/test`, "POST", {
          topic: document.getElementById("listener-test-topic").value || null,
          payload: parseJsonField("listener-test-payload")
        });
        const verdict = result.launched ? `Run started: ${result.run_id}` : result.filtered ? "Message filtered out" : result.dropped ? "Dropped: listener is at max in-flight" : result.error || "Not launched";
        document.getElementById("listener-test-result").innerHTML = `<p>${escapeHtml(verdict)}</p><h3>Inputs delivered to the workflow</h3><pre>${escapeHtml(JSON.stringify(result.inputs || {}, null, 2))}</pre>`;
        await loadAll();
      } catch (error) { modalError(error); }
    });
  }

  async function openRunDetail(id) {
    try {
      state.detail = await request(`/api/runs/${encodeURIComponent(id)}`);
      const run = state.detail;
      const actions = [
        run.status === "RUNNING" ? `<button data-action="run-cancel" data-id="${escapeHtml(id)}">Cancel</button>` : "",
        ["FAILED", "CANCELLED", "INTERRUPTED"].includes(run.status) ? `<button data-action="run-resume" data-id="${escapeHtml(id)}">Resume</button>` : "",
        run.status !== "RUNNING" ? `<button data-action="run-restart" data-id="${escapeHtml(id)}">Restart</button><button class="danger" data-action="run-delete" data-id="${escapeHtml(id)}">Delete</button>` : "",
        `<button data-action="open-report" data-id="${escapeHtml(id)}">Open HTML report</button>`
      ].join("");
      showModal(`Run ${run.workflow} · ${run.status}`, `<div class="detail-actions">${actions}</div>
        <h3>Inputs</h3><pre>${escapeHtml(JSON.stringify(run.inputs || {}, null, 2))}</pre>
        <h3>Outputs</h3><pre>${escapeHtml(JSON.stringify(run.outputs || {}, null, 2))}</pre>
        ${run.error ? `<h3>Error</h3><pre class="error">${escapeHtml(run.error)}</pre>` : ""}
        <h3>Steps (${(run.steps || []).length})</h3>${(run.steps || []).map(step => `<details class="step-detail"><summary><span class="status ${escapeHtml(String(step.status).toLowerCase())}">${escapeHtml(step.status)}</span> ${escapeHtml(step.name)} ${step.duration_ms ? `· ${escapeHtml(formatDuration(step.duration_ms))}` : ""}</summary><pre>${escapeHtml(JSON.stringify({ args: step.args, result: step.result, error: step.error, logs: step.logs }, null, 2))}</pre></details>`).join("") || `<p class="muted">No step details.</p>`}`, "", () => {});
      document.getElementById("modal-submit").remove();
    } catch (error) { toast(error.message); }
  }

  function parseJsonField(id) {
    const value = document.getElementById(id).value.trim();
    const result = value ? JSON.parse(value) : {};
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Inputs must be a JSON object.");
    return result;
  }

  function modalError(error) {
    const element = document.getElementById("modal-error");
    if (element) element.textContent = error.message;
  }

  function closeModal() {
    document.getElementById("modal-root").innerHTML = "";
  }

  function toast(message) {
    const element = document.getElementById("toast");
    if (!element) return;
    element.textContent = message;
    element.classList.add("show");
    setTimeout(() => element.classList.remove("show"), 3500);
  }

  function formatDuration(ms) {
    if (ms === undefined || ms === null) return "—";
    return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
  }

  app.addEventListener("click", async event => {
    const button = event.target.closest("[data-action]");
    const tab = event.target.closest("[data-tab]");
    if (tab) {
      state.tab = tab.dataset.tab;
      state.selectedFlow = null;
      state.dashboard = null;
      clearInterval(state.dashboardTimer);
      render();
      if (state.tab === "history") loadAll();
      if (state.tab === "schedules") loadAll();
      return;
    }
    if (!button) return;
    const { action, name, id } = button.dataset;
    try {
      if (action === "refresh") await loadAll();
      else if (action === "configure") vscode.postMessage({ type: "configure" });
      else if (action === "create-workflow") vscode.postMessage({ type: "createWorkflow" });
      else if (action === "flow-detail") { state.selectedFlow = name; render(); }
      else if (action === "back-flows") { state.selectedFlow = null; render(); }
      else if (action === "run-flow") openRunModal(name);
      else if (action === "dashboard-open") {
        state.dashboard = { name, inputs: state.flows.find(flow => flow.name === name)?.inputs || {}, env: "", autoRefresh: 0 };
        await refreshDashboard();
      } else if (action === "back-dashboards") {
        clearInterval(state.dashboardTimer); state.dashboard = null; render();
      } else if (action === "dashboard-refresh") await refreshDashboard();
      else if (action === "new-schedule") openScheduleModal();
      else if (action === "new-listener") openListenerModal();
      else if (action === "listener-test") openListenerTest(id);
      else if (action === "listener-delete") {
        showModal("Delete listener", "<p>This removes the listener and closes its broker connection.</p>", "Delete listener", async () => {
          try {
            await request(`/api/listeners/${encodeURIComponent(id)}`, "DELETE");
            closeModal();
            await loadAll();
          } catch (error) { modalError(error); }
        });
      }
      else if (action === "modal-close") closeModal();
      else if (action === "run-detail") await openRunDetail(id);
      else if (action === "open-report") vscode.postMessage({ type: "openReport", runId: id });
      else if (action === "run-cancel") { await request(`/api/runs/${encodeURIComponent(id)}/cancel`, "POST"); await openRunDetail(id); }
      else if (action === "run-resume" || action === "run-restart") {
        const result = await request(`/api/runs/${encodeURIComponent(id)}/${action === "run-resume" ? "resume" : "restart"}`, "POST");
        toast(`Started ${result.run_id}`);
        await loadAll();
        await openRunDetail(result.run_id);
      } else if (action === "run-delete") {
        await request(`/api/runs/${encodeURIComponent(id)}`, "DELETE");
        closeModal(); await loadAll();
      } else if (action === "clear-history") {
        showModal("Clear run history", "<p>All finished runs will be deleted. Running runs are kept.</p>", "Delete finished runs", async () => {
          try {
            await request("/api/runs", "DELETE");
            closeModal();
            await loadAll();
          } catch (error) { modalError(error); }
        });
      } else if (action === "schedule-run") {
        const result = await request(`/api/schedules/${encodeURIComponent(id)}/run`, "POST");
        toast(`Started run ${result.run_id}`); await loadAll();
      } else if (action === "schedule-delete") {
        showModal("Delete schedule", "<p>This schedule will be removed.</p>", "Delete schedule", async () => {
          try {
            await request(`/api/schedules/${encodeURIComponent(id)}`, "DELETE");
            closeModal();
            await loadAll();
          } catch (error) { modalError(error); }
        });
      }
    } catch (error) { toast(error.message); }
  });

  app.addEventListener("change", async event => {
    if (event.target.matches("[data-action='schedule-toggle']")) {
      try {
        await request(`/api/schedules/${encodeURIComponent(event.target.dataset.id)}`, "PATCH", { enabled: event.target.checked });
        await loadAll();
      } catch (error) { toast(error.message); }
    }
    if (event.target.matches("[data-action='listener-toggle']")) {
      try {
        await request(`/api/listeners/${encodeURIComponent(event.target.dataset.id)}`, "PATCH", { enabled: event.target.checked });
        await loadAll();
      } catch (error) { toast(error.message); }
    }
    if (event.target.id === "dash-env") {
      state.dashboard.env = event.target.value;
      await refreshDashboard();
    }
    if (event.target.id === "dash-auto") {
      clearInterval(state.dashboardTimer);
      const seconds = Number(event.target.value);
      state.dashboard.autoRefresh = seconds;
      if (seconds) state.dashboardTimer = setInterval(refreshDashboard, seconds * 1000);
    }
  });

  app.addEventListener("input", event => {
    if (event.target.id !== "history-search" && event.target.id !== "history-status") return;
    const query = document.getElementById("history-search").value.toLowerCase();
    const status = document.getElementById("history-status").value;
    const runs = state.runs.filter(run =>
      (!status || run.status === status) &&
      [run.workflow, run.run_id, run.status].some(value => String(value || "").toLowerCase().includes(query))
    );
    document.getElementById("history-rows").innerHTML = renderRunRows(runs);
  });

  async function refreshDashboard() {
    if (!state.dashboard) return;
    try {
      const input = document.getElementById("dash-inputs");
      if (input) state.dashboard.inputs = parseJsonField("dash-inputs");
      const environment = document.getElementById("dash-env");
      if (environment) state.dashboard.env = environment.value;
      const data = await request(`/api/dashboards/${encodeURIComponent(state.dashboard.name)}/render`, "POST", {
        inputs: state.dashboard.inputs,
        env: state.dashboard.env || null
      });
      state.dashboard.data = data;
    } catch (error) {
      state.dashboard.data = { error: error.message, widgets: [] };
    }
    render();
  }

  loadAll();
  setInterval(async () => {
    if (state.tab !== "history") return;
    try {
      state.runs = (await request("/api/runs")).runs || [];
      const query = document.getElementById("history-search")?.value.toLowerCase() || "";
      const status = document.getElementById("history-status")?.value || "";
      const runs = state.runs.filter(run =>
        (!status || run.status === status) &&
        [run.workflow, run.run_id, run.status].some(value => String(value || "").toLowerCase().includes(query))
      );
      const rows = document.getElementById("history-rows");
      if (rows) rows.innerHTML = renderRunRows(runs);
    } catch (error) {
      toast(error.message);
    }
  }, 5000);
})();
