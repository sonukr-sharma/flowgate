/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { suite, test } from 'node:test';
import { copyFile, mapWithConcurrency, transpileFile } from '../transpile.ts';

suite('transpile', () => {
	test('bounds concurrent work and preserves result order', async () => {
		let active = 0;
		let maximumActive = 0;

		const results = await mapWithConcurrency([0, 1, 2, 3, 4], 2, async item => {
			active++;
			maximumActive = Math.max(maximumActive, active);
			await new Promise(resolve => setImmediate(resolve));
			active--;
			return item * 2;
		});

		assert.deepStrictEqual({ maximumActive, results }, {
			maximumActive: 2,
			results: [0, 2, 4, 6, 8],
		});
	});

	test('propagates errors and stops scheduling work', async () => {
		const started: number[] = [];

		await assert.rejects(mapWithConcurrency([0, 1, 2, 3], 2, async item => {
			started.push(item);
			if (item === 0) {
				throw new Error('expected failure');
			}
			await new Promise(resolve => setImmediate(resolve));
		}), /expected failure/);

		assert.deepStrictEqual(started, [0, 1]);
	});

	test('transpileFile never exposes a partially written module', async () => {
		const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vscode-transpile-atomic-'));
		try {
			const srcPath = path.join(root, 'source.ts');
			const destPath = path.join(root, 'out', 'source.js');
			await fs.promises.writeFile(srcPath, 'export const value = 1;\n');

			// Seed the destination so a truncating write would be observable.
			await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
			await fs.promises.writeFile(destPath, 'export const value = 0;\n');

			const reads: string[] = [];
			let done = false;
			const reader = (async () => {
				while (!done) {
					reads.push(await fs.promises.readFile(destPath, 'utf-8'));
					await new Promise(resolve => setImmediate(resolve));
				}
			})();

			await transpileFile(srcPath, destPath);
			done = true;
			await reader;

			const finalContents = await fs.promises.readFile(destPath, 'utf-8');
			assert.ok(finalContents.includes('value = 1'), 'destination should hold the new contents');
			assert.deepStrictEqual(
				reads.filter(contents => contents !== 'export const value = 0;\n' && !contents.includes('value = 1')),
				[],
				'no read should observe a partially written module'
			);
			assert.deepStrictEqual(
				(await fs.promises.readdir(path.dirname(destPath))).filter(name => name.endsWith('.tmp')),
				[],
				'temporary files should be cleaned up'
			);
		} finally {
			await fs.promises.rm(root, { recursive: true, force: true });
		}
	});

	test('copyFile replaces the destination atomically and preserves contents', async () => {
		const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vscode-copy-atomic-'));
		try {
			const srcPath = path.join(root, 'source.css');
			const destPath = path.join(root, 'out', 'source.css');
			await fs.promises.writeFile(srcPath, 'body { color: red; }\n');

			await copyFile(srcPath, destPath);

			assert.deepStrictEqual({
				contents: await fs.promises.readFile(destPath, 'utf-8'),
				temporaryFiles: (await fs.promises.readdir(path.dirname(destPath))).filter(name => name.endsWith('.tmp')),
			}, {
				contents: 'body { color: red; }\n',
				temporaryFiles: [],
			});
		} finally {
			await fs.promises.rm(root, { recursive: true, force: true });
		}
	});

	test('transpileFile still writes when the destination cannot be replaced', async () => {
		const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vscode-transpile-locked-'));
		try {
			const srcPath = path.join(root, 'source.ts');
			const destPath = path.join(root, 'out', 'source.js');
			await fs.promises.writeFile(srcPath, 'export const value = 1;\n');
			await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
			await fs.promises.writeFile(destPath, 'export const value = 0;\n');

			// Windows refuses to rename over a destination that another handle has open.
			const handle = await fs.promises.open(destPath, 'r');
			try {
				await transpileFile(srcPath, destPath);
			} finally {
				await handle.close();
			}

			const contents = await fs.promises.readFile(destPath, 'utf-8');
			assert.deepStrictEqual({
				hasNewContents: contents.includes('value = 1'),
				temporaryFiles: (await fs.promises.readdir(path.dirname(destPath))).filter(name => name.endsWith('.tmp')),
			}, {
				hasNewContents: true,
				temporaryFiles: [],
			});
		} finally {
			await fs.promises.rm(root, { recursive: true, force: true });
		}
	});
});
