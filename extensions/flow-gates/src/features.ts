/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ensureConfigured, getProjectConfigUri, readProjectConfig } from './projectConfig';

const MAP_FILE = 'flow.map.json';

/**
 * Placeholder for the AI-backed feature. It is config-dependent, so it must go
 * through ensureConfigured() before doing any work.
 */
export async function runAiFeature(context: vscode.ExtensionContext, openSetupForm: () => Promise<void>): Promise<void> {
	if (!await ensureConfigured(context, openSetupForm)) {
		return;
	}

	const config = await readProjectConfig();
	vscode.window.showInformationMessage(`AI feature is not implemented yet (project: ${config?.projectName ?? 'unknown'}).`);
}

/** Placeholder for code conversion. Also config-dependent. */
export async function convertCode(context: vscode.ExtensionContext, openSetupForm: () => Promise<void>): Promise<void> {
	if (!await ensureConfigured(context, openSetupForm)) {
		return;
	}

	const config = await readProjectConfig();
	vscode.window.showInformationMessage(`Code conversion is not implemented yet (project: ${config?.projectName ?? 'unknown'}).`);
}

/** Editing the map by hand needs no setup. */
export async function editMap(): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showWarningMessage('Open a folder to edit the map.');
		return;
	}

	const uri = vscode.Uri.joinPath(folder.uri, MAP_FILE);
	try {
		await vscode.workspace.fs.stat(uri);
	} catch {
		await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode('{\n  "nodes": [],\n  "edges": []\n}\n'));
	}

	await vscode.window.showTextDocument(uri);
}

/** Saving the map file needs no setup. */
export async function saveMap(): Promise<void> {
	const uri = getProjectConfigUri();
	if (!uri) {
		void vscode.window.showWarningMessage('Open a folder to save the map.');
		return;
	}

	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return;
	}

	const mapUri = vscode.Uri.joinPath(folder.uri, MAP_FILE);
	try {
		await vscode.workspace.fs.stat(mapUri);
		void vscode.window.showInformationMessage(`Map saved to ${MAP_FILE}.`);
	} catch {
		void vscode.window.showWarningMessage(`No map file found. Use "Edit Map" to create ${MAP_FILE}.`);
	}
}
