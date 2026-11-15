import * as vscode from "vscode";

let panel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("codeFlow.open", () => openPanel(context)),
    vscode.commands.registerCommand("codeFlow.createWorkflow", createWorkflow),
    vscode.commands.registerCommand("codeFlow.configureServer", configureServer)
  );
}

export function deactivate(): void {
  panel?.dispose();
}

function openPanel(context: vscode.ExtensionContext): void {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Active);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    "codeFlow.dashboard",
    "Code Flow",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")]
    }
  );
  panel.webview.html = getHtml(panel.webview, context.extensionUri);
  panel.webview.onDidReceiveMessage(
    message => handleMessage(panel?.webview, message),
    undefined,
    context.subscriptions
  );
  panel.onDidDispose(() => {
    panel = undefined;
  }, undefined, context.subscriptions);
}

async function handleMessage(
  webview: vscode.Webview | undefined,
  message: unknown
): Promise<void> {
  if (!webview || !isRecord(message)) {
    return;
  }

  if (message.type === "request") {
    const requestId = typeof message.id === "string" ? message.id : "";
    const route = typeof message.path === "string" ? message.path : "";
    const method = typeof message.method === "string" ? message.method.toUpperCase() : "GET";
    if (!requestId || !route.startsWith("/api/") || !["GET", "POST", "PATCH", "DELETE"].includes(method)) {
      await webview.postMessage({ type: "response", id: requestId, ok: false, error: "Invalid API request." });
      return;
    }

    try {
      const base = configuredBaseUrl();
      const url = new URL(route.slice(1), `${base}/`);
      if (url.origin !== new URL(base).origin || !url.pathname.startsWith("/api/")) {
        throw new Error("The requested API path is not allowed.");
      }
      const response = await fetch(url, {
        method,
        headers: message.body === undefined ? undefined : { "Content-Type": "application/json" },
        body: message.body === undefined ? undefined : JSON.stringify(message.body),
        signal: AbortSignal.timeout(20_000)
      });
      const text = await response.text();
      let data: unknown = text;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      await webview.postMessage({
        type: "response",
        id: requestId,
        ok: response.ok,
        status: response.status,
        data
      });
    } catch (error) {
      await webview.postMessage({
        type: "response",
        id: requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }

  if (message.type === "openReport" && typeof message.runId === "string") {
    if (!/^[\w-]+$/.test(message.runId)) {
      return;
    }
    try {
      const reportUrl = new URL(`/reports/${encodeURIComponent(message.runId)}`, configuredBaseUrl());
      await vscode.env.openExternal(vscode.Uri.parse(reportUrl.toString()));
    } catch (error) {
      vscode.window.showErrorMessage(`Could not open report: ${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }

  if (message.type === "configure") {
    await configureServer();
    return;
  }

  if (message.type === "createWorkflow") {
    await createWorkflow();
  }
}

function configuredBaseUrl(): string {
  const value = vscode.workspace.getConfiguration("codeFlow").get<string>("serverUrl", "http://127.0.0.1:8000").trim();
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Code Flow server URL must use HTTP or HTTPS.");
  }
  return url.toString().replace(/\/+$/, "");
}

async function configureServer(): Promise<void> {
  const current = vscode.workspace.getConfiguration("codeFlow").get<string>("serverUrl", "http://127.0.0.1:8000");
  const value = await vscode.window.showInputBox({
    title: "Code Flow Server URL",
    value: current,
    prompt: "Enter the base URL of your Code Flow server",
    validateInput: input => {
      try {
        const url = new URL(input);
        return url.protocol === "http:" || url.protocol === "https:" ? undefined : "Use an HTTP or HTTPS URL.";
      } catch {
        return "Enter a valid server URL, for example http://127.0.0.1:8000.";
      }
    }
  });
  if (value) {
    await vscode.workspace.getConfiguration("codeFlow").update(
      "serverUrl",
      value.replace(/\/+$/, ""),
      vscode.ConfigurationTarget.Workspace
    );
    vscode.window.showInformationMessage("Code Flow server URL updated.");
  }
}

async function createWorkflow(): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (!workspace) {
    vscode.window.showErrorMessage("Open a workspace folder before creating a Code Flow workflow.");
    return;
  }
  const className = await vscode.window.showInputBox({
    title: "Create Code Flow Workflow",
    prompt: "Enter a Python class name (the Flow suffix is added automatically)",
    value: "Example",
    validateInput: value => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? undefined : "Use a valid Python class name."
  });
  if (!className) {
    return;
  }

  const configuredDir = vscode.workspace.getConfiguration("codeFlow").get<string>("workflowsDirectory", "workflows");
  const segments = configuredDir.replace(/\\/g, "/").split("/").filter(segment => segment && segment !== ".");
  if (configuredDir.startsWith("/") || segments.includes("..")) {
    vscode.window.showErrorMessage("The workflows directory must be a relative path inside the workspace.");
    return;
  }
  const workflowsDir = vscode.Uri.joinPath(workspace.uri, ...segments);
  const file = vscode.Uri.joinPath(workflowsDir, `${className}.py`);
  try {
    await vscode.workspace.fs.createDirectory(workflowsDir);
    const edit = new vscode.WorkspaceEdit();
    edit.createFile(file, { overwrite: false });
    edit.insert(file, new vscode.Position(0, 0), workflowTemplate(className));
    if (!await vscode.workspace.applyEdit(edit)) {
      vscode.window.showErrorMessage(`Could not create ${className}.py. A file with that name may already exist.`);
      return;
    }
    const document = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(document);
  } catch (error) {
    vscode.window.showErrorMessage(`Could not create workflow: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function workflowTemplate(name: string): string {
  return `from engine import Workflow, flow, step


class ${name}Flow(Workflow):
    description = "Describe what this workflow does"
    inputs = {"name": "world"}

    @flow
    def main(self, ctx):
        greeting = self.build_greeting(ctx["name"])
        return {"greeting": greeting}

    @step()
    def build_greeting(self, name):
        return f"Hello, {name}!"
`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = [...Array(32)].map(() => Math.random().toString(36)[2] ?? "0").join("");
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "app.js"));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "styles.css"));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${style}" rel="stylesheet">
  <title>Code Flow</title>
</head>
<body>
  <div id="app"><p class="loading">Connecting to Code Flow…</p></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
