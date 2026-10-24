/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export const PROJECT_CONFIG_FILE = 'project.config.json';

/** Workspace-scoped flag set when the user dismisses the setup form with "Skip for now". */
export const SETUP_SKIPPED_KEY = 'setupSkipped';

/** The API key never lives in project.config.json; it is kept in the secret storage. */
export const API_KEY_SECRET = 'flowgates.apiKey';

export interface IProjectConfig {
	readonly projectName: string;
	readonly apiEndpoint?: string;
}

function getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
	return vscode.workspace.workspaceFolders?.[0];
}

export function getProjectConfigUri(): vscode.Uri | undefined {
	const folder = getWorkspaceFolder();
	return folder ? vscode.Uri.joinPath(folder.uri, PROJECT_CONFIG_FILE) : undefined;
}

function validateProjectConfig(value: unknown): IProjectConfig | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}

	const candidate = value as Record<string, unknown>;
	if (typeof candidate.projectName !== 'string' || candidate.projectName.trim().length === 0) {
		return undefined;
	}

	if (candidate.apiEndpoint !== undefined && typeof candidate.apiEndpoint !== 'string') {
		return undefined;
	}

	return {
		projectName: candidate.projectName.trim(),
		apiEndpoint: typeof candidate.apiEndpoint === 'string' ? candidate.apiEndpoint.trim() : undefined
	};
}

/** Reads and validates project.config.json. Returns undefined when missing or invalid. */
export async function readProjectConfig(): Promise<IProjectConfig | undefined> {
	const uri = getProjectConfigUri();
	if (!uri) {
		return undefined;
	}

	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		return validateProjectConfig(JSON.parse(new TextDecoder().decode(bytes)));
	} catch {
		return undefined;
	}
}

/** True when project.config.json exists and is valid. */
export async function isConfigFileValid(): Promise<boolean> {
	return (await readProjectConfig()) !== undefined;
}

export async function hasApiKey(context: vscode.ExtensionContext): Promise<boolean> {
	const key = await context.secrets.get(API_KEY_SECRET);
	return typeof key === 'string' && key.length > 0;
}

/**
 * The guard every config-dependent feature must call first. A project counts as
 * configured only when project.config.json is valid *and* an API key is stored.
 */
export async function isProjectConfigured(context: vscode.ExtensionContext): Promise<boolean> {
	return (await isConfigFileValid()) && (await hasApiKey(context));
}

export function isSetupSkipped(context: vscode.ExtensionContext): boolean {
	return context.workspaceState.get<boolean>(SETUP_SKIPPED_KEY, false) === true;
}

export async function markSetupSkipped(context: vscode.ExtensionContext): Promise<void> {
	await context.workspaceState.update(SETUP_SKIPPED_KEY, true);
}

export async function clearSetupSkipped(context: vscode.ExtensionContext): Promise<void> {
	await context.workspaceState.update(SETUP_SKIPPED_KEY, undefined);
}

/**
 * Shows the "setup needed" prompt and returns false so the caller can bail out.
 * Returns true only when the project is already configured.
 */
export async function ensureConfigured(context: vscode.ExtensionContext, openSetupForm: () => Promise<void>): Promise<boolean> {
	if (await isProjectConfigured(context)) {
		return true;
	}

	const choice = await vscode.window.showWarningMessage(
		'Project setup is needed for this feature',
		'Set up now',
		'Cancel'
	);

	if (choice === 'Set up now') {
		await openSetupForm();
	}

	return false;
}
