/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { convertCode, editMap, runAiFeature, saveMap } from './features';
import { isConfigFileValid, isSetupSkipped } from './projectConfig';
import { openSetupForm } from './setupForm';

const MODE_KEY = 'flowgates.mode';
const MODES = ['code', 'map'] as const;
type Mode = typeof MODES[number];

let currentMode: Mode = 'code';
let statusBarItem: vscode.StatusBarItem | undefined;

function getStoredMode(context: vscode.ExtensionContext): Mode {
	const stored = context.workspaceState.get<string>(MODE_KEY);
	return stored === 'map' ? 'map' : 'code';
}

async function setMode(context: vscode.ExtensionContext, mode: unknown): Promise<void> {
	if (mode !== 'code' && mode !== 'map') {
		return;
	}

	currentMode = mode;
	await context.workspaceState.update(MODE_KEY, mode);
	await vscode.commands.executeCommand('setContext', 'flowgates.mode', mode);
}

async function updateStatusBar(context: vscode.ExtensionContext): Promise<void> {
	const valid = await isConfigFileValid();

	if (valid) {
		statusBarItem?.hide();
		return;
	}

	if (!statusBarItem) {
		statusBarItem = vscode.window.createStatusBarItem('flowgates.setup', vscode.StatusBarAlignment.Left, 100);
		statusBarItem.name = 'Flow Gates Setup';
		statusBarItem.text = '$(warning) Setup needed';
		statusBarItem.tooltip = 'Flow Gates project setup is incomplete. Click to finish it.';
		statusBarItem.command = 'flowgates.setupProject';
		context.subscriptions.push(statusBarItem);
	}

	statusBarItem.show();
}

export function activate(context: vscode.ExtensionContext): void {
	currentMode = getStoredMode(context);
	void vscode.commands.executeCommand('setContext', 'flowgates.mode', currentMode);

	const openForm = () => openSetupForm(context);

	context.subscriptions.push(
		vscode.commands.registerCommand('flowgates.setMode', async (mode: unknown) => {
			await setMode(context, mode);
		}),

		vscode.commands.registerCommand('flowgates.getMode', () => currentMode),

		vscode.commands.registerCommand('flowgates.setupProject', async () => {
			await openForm();
			await updateStatusBar(context);
		}),

		vscode.commands.registerCommand('flowgates.editProjectSettings', async () => {
			await openForm();
			await updateStatusBar(context);
		}),

		vscode.commands.registerCommand('flowgates.runAiFeature', () => runAiFeature(context, openForm)),
		vscode.commands.registerCommand('flowgates.convertCode', () => convertCode(context, openForm)),
		vscode.commands.registerCommand('flowgates.editMap', () => editMap()),
		vscode.commands.registerCommand('flowgates.saveMap', () => saveMap())
	);

	// Startup rule: only open the form when the config is invalid AND the user has not skipped.
	void (async () => {
		await updateStatusBar(context);

		if (await isConfigFileValid()) {
			return;
		}

		if (isSetupSkipped(context)) {
			return;
		}

		await openForm();
		await updateStatusBar(context);
	})();
}

export function deactivate(): void {
	statusBarItem?.dispose();
	statusBarItem = undefined;
}
