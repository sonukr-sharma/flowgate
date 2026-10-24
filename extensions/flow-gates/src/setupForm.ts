/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { API_KEY_SECRET, clearSetupSkipped, getProjectConfigUri, markSetupSkipped, readProjectConfig } from './projectConfig';

let currentPanel: vscode.WebviewPanel | undefined;

function getNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let i = 0; i < 32; i++) {
		nonce += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return nonce;
}

function getHtml(webview: vscode.Webview, projectName: string, apiEndpoint: string, hasApiKey: boolean): string {
	const nonce = getNonce();
	const csp = [
		`default-src 'none'`,
		`style-src ${webview.cspSource} 'unsafe-inline'`,
		`script-src 'nonce-${nonce}'`
	].join('; ');

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Flow Gates Setup</title>
	<style>
		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--vscode-foreground);
			padding: 20px;
			max-width: 640px;
		}
		h1 { font-size: 1.3em; font-weight: 600; margin: 0 0 4px; }
		p.hint { margin: 0 0 20px; opacity: 0.8; }
		label { display: block; margin: 16px 0 4px; font-weight: 600; }
		input {
			width: 100%;
			box-sizing: border-box;
			padding: 6px 8px;
			color: var(--vscode-input-foreground);
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border, transparent);
			border-radius: 2px;
			font-family: inherit;
			font-size: inherit;
		}
		input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
		.actions { display: flex; gap: 8px; margin-top: 24px; }
		button {
			padding: 6px 14px;
			border: 1px solid transparent;
			border-radius: 2px;
			font-family: inherit;
			font-size: inherit;
			cursor: pointer;
		}
		button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
		button.primary:hover { background: var(--vscode-button-hoverBackground); }
		button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
		button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
		button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
		.error { color: var(--vscode-errorForeground); margin-top: 12px; min-height: 1.2em; }
	</style>
</head>
<body>
	<h1>Project setup</h1>
	<p class="hint">Flow Gates needs a project name and an API key. The API key is stored in the OS secret storage, never in project.config.json.</p>

	<label for="projectName">Project name</label>
	<input id="projectName" type="text" value="${escapeAttribute(projectName)}" autofocus>

	<label for="apiEndpoint">API endpoint (optional)</label>
	<input id="apiEndpoint" type="text" value="${escapeAttribute(apiEndpoint)}">

	<label for="apiKey">API key${hasApiKey ? ' (already saved — leave blank to keep it)' : ''}</label>
	<input id="apiKey" type="password" value="">

	<div class="error" id="error" role="alert"></div>

	<div class="actions">
		<button class="primary" id="save">Save</button>
		<button class="secondary" id="skip">Skip for now</button>
	</div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const errorNode = document.getElementById('error');

		document.getElementById('save').addEventListener('click', () => {
			errorNode.textContent = '';
			vscode.postMessage({
				type: 'save',
				projectName: document.getElementById('projectName').value,
				apiEndpoint: document.getElementById('apiEndpoint').value,
				apiKey: document.getElementById('apiKey').value
			});
		});

		document.getElementById('skip').addEventListener('click', () => {
			vscode.postMessage({ type: 'skip' });
		});

		window.addEventListener('message', event => {
			if (event.data?.type === 'error') {
				errorNode.textContent = event.data.message;
			}
		});
	</script>
</body>
</html>`;
}

function escapeAttribute(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function writeProjectConfig(projectName: string, apiEndpoint: string): Promise<void> {
	const uri = getProjectConfigUri();
	if (!uri) {
		throw new Error('Open a folder before setting up the project.');
	}

	const config: Record<string, string> = { projectName };
	if (apiEndpoint.length > 0) {
		config.apiEndpoint = apiEndpoint;
	}

	await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(`${JSON.stringify(config, undefined, 2)}\n`));
}

/**
 * Opens the setup form. Resolves once the panel is closed, either by saving a
 * valid config or by skipping.
 */
export function openSetupForm(context: vscode.ExtensionContext): Promise<void> {
	if (currentPanel) {
		currentPanel.reveal();
		return Promise.resolve();
	}

	const panel = vscode.window.createWebviewPanel(
		'flowgates.setup',
		'Flow Gates Setup',
		vscode.ViewColumn.Active,
		{ enableScripts: true, retainContextWhenHidden: true }
	);
	currentPanel = panel;

	return new Promise<void>(resolve => {
		let settled = false;
		const finish = () => {
			if (!settled) {
				settled = true;
				resolve();
			}
		};

		void (async () => {
			const existing = await readProjectConfig();
			const existingKey = await context.secrets.get(API_KEY_SECRET);
			panel.webview.html = getHtml(
				panel.webview,
				existing?.projectName ?? '',
				existing?.apiEndpoint ?? '',
				typeof existingKey === 'string' && existingKey.length > 0
			);
		})();

		panel.webview.onDidReceiveMessage(async message => {
			if (message?.type === 'skip') {
				// Skip never validates and never writes project.config.json.
				await markSetupSkipped(context);
				panel.dispose();
				void vscode.window.showInformationMessage('Setup skipped. You can finish it anytime from Edit Project Settings.');
				return;
			}

			if (message?.type !== 'save') {
				return;
			}

			const projectName = typeof message.projectName === 'string' ? message.projectName.trim() : '';
			const apiEndpoint = typeof message.apiEndpoint === 'string' ? message.apiEndpoint.trim() : '';
			const apiKey = typeof message.apiKey === 'string' ? message.apiKey.trim() : '';

			if (projectName.length === 0) {
				void panel.webview.postMessage({ type: 'error', message: 'Project name is required.' });
				return;
			}

			const alreadyHasKey = (await context.secrets.get(API_KEY_SECRET))?.length;
			if (apiKey.length === 0 && !alreadyHasKey) {
				void panel.webview.postMessage({ type: 'error', message: 'API key is required.' });
				return;
			}

			try {
				await writeProjectConfig(projectName, apiEndpoint);
				if (apiKey.length > 0) {
					await context.secrets.store(API_KEY_SECRET, apiKey);
				}
				await clearSetupSkipped(context);
				panel.dispose();
				void vscode.window.showInformationMessage('Project setup complete.');
			} catch (error) {
				void panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
			}
		});

		panel.onDidDispose(() => {
			currentPanel = undefined;
			finish();
		});
	});
}
