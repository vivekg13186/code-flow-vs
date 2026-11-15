# Code Flow for VS Code

Manage a running Code Flow server without leaving Visual Studio Code. The
extension provides a Webview dashboard for workflows,
dashboards, run history, schedules, and masked environment values. It talks to
the server's existing REST API; it does not start or install the Python server.

## Run the extension locally

1. Open this folder in VS Code.
2. Run `npm install`.
3. Press **F5** and choose **Run Code Flow Extension** to open the Extension
   Development Host. The launch configuration compiles the extension first.
4. In that new VS Code window, run **Code Flow: Open Dashboard** from the
   Command Palette. The command is contributed by the extension and is not
   available in the source-editing window.
5. Start the server in your Code Flow project (default URL
   `http://127.0.0.1:8000`). Change it with **Code Flow: Configure Server URL**
   or the `codeFlow.serverUrl` setting.

The extension host proxies API requests, so the Webview does not need
cross-origin access to the local server. The server itself has no authentication;
keep it bound to loopback or use a trusted network.

## Python workflow editing

The extension contributes Python snippets: `cf-workflow`, `cf-step`,
`cf-inputs`, and `cf-widget`. **Code Flow: Create Python Workflow** creates a
starter workflow under `codeFlow.workflowsDirectory` (default `workflows`)
inside the first workspace folder. Python language support, type checking, and
debugging continue to come from the user's Python extension (such as Pylance).

## Features

- Browse workflow metadata, source, tags, typed inputs, and steps; launch runs
  with JSON inputs and an environment.
- Inspect run records and step logs, cancel or resume runs, restart runs,
  delete completed history, and open the server's HTML report.
- Run dashboard workflows and refresh them manually or on a timer.
- Create interval/daily schedules, enable or disable them, run them now, and
  remove them.
- View environment values in the server-masked form.

## Build

```sh
npm install
npm run package
```

This creates `code-flow-vscode-<version>.vsix` in the project folder. Share
that file for sideload installation, or install it locally with:

```sh
code --install-extension code-flow-vscode-0.1.0.vsix
```

For each release, update `version` in `package.json` before packaging. To
publish to the Visual Studio Marketplace instead, create a publisher, set
`publisher` in `package.json` to that publisher's ID, and create a Marketplace
Personal Access Token. Then use `npx vsce publish`; keep the token out of
source control and pass it through the supported VSCE credential flow.
