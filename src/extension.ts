import * as vscode from 'vscode';
import { COLOR_PALETTE } from './colors';
import { GroupManager, TabGroupRecord, getTabKey } from './groupManager';
import { TabGroupDecorationProvider } from './decorationProvider';
import { GroupNode, TabGroupsTreeDataProvider, TabNode, TabRef } from './treeView';
import { organizeTabs } from './tabOrganizer';

function flattenLiveTabs(): vscode.Tab[] {
	return vscode.window.tabGroups.all.flatMap(g => g.tabs);
}

function getActiveTabKey(): string | undefined {
	const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
	return tab ? getTabKey(tab) : undefined;
}

async function pickColor(currentKey?: string): Promise<string | undefined> {
	const picked = await vscode.window.showQuickPick(
		COLOR_PALETTE.map(c => ({ label: `${c.swatch} ${c.label}`, key: c.key, picked: c.key === currentKey })),
		{ placeHolder: 'Choose a group color' }
	);
	return picked?.key;
}

async function pickGroup(manager: GroupManager, placeHolder: string): Promise<TabGroupRecord | undefined> {
	const groups = manager.getGroups();
	if (groups.length === 0) {
		vscode.window.showInformationMessage('No tab groups yet. Create one first.');
		return undefined;
	}
	const picked = await vscode.window.showQuickPick(
		groups.map(g => ({ label: `${manager.colorFor(g.id).swatch} ${g.name}`, description: `${g.memberKeys.length} tab(s)`, id: g.id })),
		{ placeHolder }
	);
	return picked ? manager.getGroup(picked.id) : undefined;
}

async function resolveGroup(manager: GroupManager, node: GroupNode | TabNode | undefined, placeHolder: string): Promise<TabGroupRecord | undefined> {
	if (node instanceof GroupNode) {
		return node.record;
	}
	if (node instanceof TabNode) {
		return node.group;
	}
	return pickGroup(manager, placeHolder);
}

const SETUP_PROMPTED_KEY = 'tabColorGroups.setupPromptShown';

// Enables Color Decorations for Tabs
async function ensureTabDecorationColorsEnabled(output: vscode.OutputChannel): Promise<boolean> {
	const config = vscode.workspace.getConfiguration('workbench.editor');
	const current = config.get<boolean>('decorations.colors');
	output.appendLine(`workbench.editor.decorations.colors effective value at activation: ${current}`);
	if (current === true) {
		return true;
	}
	const choice = await vscode.window.showInformationMessage(
		'Tab Color Groups needs the "workbench.editor.decorations.colors" setting enabled to color tabs.',
		'Enable Setting'
	);
	if (choice === 'Enable Setting') {
		await config.update('decorations.colors', true, vscode.ConfigurationTarget.Global);
		output.appendLine('workbench.editor.decorations.colors set to true (Global). A window reload may be required.');
		return true;
	}
	return false;
}

// Overiding Gits Color decorations on initial set up
async function promptDisableGitDecorations(output: vscode.OutputChannel): Promise<void> {
	const config = vscode.workspace.getConfiguration('git');
	if (config.get<boolean>('decorations.enabled') === false) {
		return;
	}
	const choice = await vscode.window.showInformationMessage(
		'Git\'s file decorations (colors for modified/untracked files) can override Tab Color Groups\' colors on the same file. Disable Git decorations for fully reliable tab colors? You can always re-enable them in the side menu.',
		'Disable Git Decorations',
		'Keep Git Decorations'
	);
	if (choice === 'Disable Git Decorations') {
		await config.update('decorations.enabled', false, vscode.ConfigurationTarget.Global);
		output.appendLine('git.decorations.enabled set to false (Global).');
	}
}


async function runFirstInstallSetup(context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<void> {
	if (context.globalState.get<boolean>(SETUP_PROMPTED_KEY)) {
		return;
	}
	await context.globalState.update(SETUP_PROMPTED_KEY, true);
	const colorsEnabled = await ensureTabDecorationColorsEnabled(output);
	if (colorsEnabled) {
		await promptDisableGitDecorations(output);
	}
}

const GIT_DECORATIONS_CONTEXT_KEY = 'tabColorGroups.gitDecorationsEnabled';

// Toggle Git Decorations
function updateGitDecorationsContext(): void {
	const enabled = vscode.workspace.getConfiguration('git').get<boolean>('decorations.enabled') !== false;
	void vscode.commands.executeCommand('setContext', GIT_DECORATIONS_CONTEXT_KEY, enabled);
}

async function setGitDecorationsEnabled(enabled: boolean): Promise<void> {
	await vscode.workspace.getConfiguration('git').update('decorations.enabled', enabled, vscode.ConfigurationTarget.Global);
}

export function activate(context: vscode.ExtensionContext) {
	
	const manager = new GroupManager(context.workspaceState);
	const treeProvider = new TabGroupsTreeDataProvider(manager);
	const output = vscode.window.createOutputChannel('Tab Color Groups');
	context.subscriptions.push(output);

	void runFirstInstallSetup(context, output);

	updateGitDecorationsContext();
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('git.decorations.enabled')) {
				updateGitDecorationsContext();
			}
		})
	);

	// On startup, VS Code restores tabs asynchronously; onDidChangeTabs fires repeatedly with a
	// momentarily incomplete tab list, which would otherwise look like closed tabs to prune.
	let pruneTimer: NodeJS.Timeout | undefined;
	const schedulePrune = () => {
		clearTimeout(pruneTimer);
		pruneTimer = setTimeout(() => {
			const openKeys = new Set<string>();
			for (const tab of flattenLiveTabs()) {
				const key = getTabKey(tab);
				if (key) {
					openKeys.add(key);
				}
			}
			void manager.pruneClosedTabs(openKeys);
		}, 500);
	};

	context.subscriptions.push(
		vscode.window.registerFileDecorationProvider(new TabGroupDecorationProvider(manager, output)),
		vscode.window.createTreeView('tabColorGroups.view', { treeDataProvider: treeProvider, dragAndDropController: treeProvider }),
		vscode.window.tabGroups.onDidChangeTabs(schedulePrune),
		new vscode.Disposable(() => clearTimeout(pruneTimer))
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('tabColorGroups.refresh', () => treeProvider.refresh()),

		vscode.commands.registerCommand('tabColorGroups.disableGitDecorations', () => setGitDecorationsEnabled(false)),

		vscode.commands.registerCommand('tabColorGroups.enableGitDecorations', () => setGitDecorationsEnabled(true)),

		vscode.commands.registerCommand('tabColorGroups.organizeTabs', () => organizeTabs(manager)),

		vscode.commands.registerCommand('tabColorGroups.createGroup', async () => {
			const name = await vscode.window.showInputBox({ prompt: 'Name for the new tab group', placeHolder: 'e.g. Frontend' });
			if (!name) {
				return;
			}
			const colorKey = await pickColor();
			const group = await manager.createGroup(name, colorKey);

			const activeKey = getActiveTabKey();
			if (activeKey) {
				const addActive = await vscode.window.showQuickPick(['Yes', 'No'], { placeHolder: `Add the current tab to "${name}"?` });
				if (addActive === 'Yes') {
					await manager.addTabToGroup(activeKey, group.id);
					await organizeTabs(manager);
				}
			}
		}),

		vscode.commands.registerCommand('tabColorGroups.addActiveTabToGroup', async (arg?: vscode.Uri | TabRef) => {
			const key = arg instanceof vscode.Uri ? arg.toString() : (arg?.key ?? getActiveTabKey());
			if (!key) {
				vscode.window.showWarningMessage('This tab type cannot be added to a group.');
				return;
			}
			const groups = manager.getGroups();
			const createNew = '$(add) Create New Group…';
			const picked = await vscode.window.showQuickPick(
				[...groups.map(g => ({ label: `${manager.colorFor(g.id).swatch} ${g.name}`, id: g.id })), { label: createNew, id: undefined }],
				{ placeHolder: 'Add tab to which group?' }
			);
			if (!picked) {
				return;
			}
			let groupId = picked.id;
			if (!groupId) {
				const name = await vscode.window.showInputBox({ prompt: 'Name for the new tab group' });
				if (!name) {
					return;
				}
				const colorKey = await pickColor();
				groupId = (await manager.createGroup(name, colorKey)).id;
			}
			await manager.addTabToGroup(key, groupId);
			await organizeTabs(manager);
		}),

		vscode.commands.registerCommand('tabColorGroups.removeTabFromGroup', async (node?: TabNode) => {
			const key = node instanceof TabNode ? node.key : getActiveTabKey();
			if (!key) {
				vscode.window.showWarningMessage('No tab selected to remove from its group.');
				return;
			}
			await manager.removeTabFromGroup(key);
		}),

		vscode.commands.registerCommand('tabColorGroups.renameGroup', async (node?: GroupNode) => {
			const group = await resolveGroup(manager, node, 'Rename which group?');
			if (!group) {
				return;
			}
			const name = await vscode.window.showInputBox({ prompt: 'New name for the group', value: group.name });
			if (!name) {
				return;
			}
			await manager.renameGroup(group.id, name);
		}),

		vscode.commands.registerCommand('tabColorGroups.changeGroupColor', async (node?: GroupNode) => {
			const group = await resolveGroup(manager, node, 'Change the color of which group?');
			if (!group) {
				return;
			}
			const colorKey = await pickColor(group.colorKey);
			if (!colorKey) {
				return;
			}
			await manager.setGroupColor(group.id, colorKey);
		}),

		vscode.commands.registerCommand('tabColorGroups.deleteGroup', async (node?: GroupNode) => {
			const group = await resolveGroup(manager, node, 'Delete which group?');
			if (!group) {
				return;
			}
			const confirm = await vscode.window.showWarningMessage(
				`Delete group "${group.name}"? Tabs stay open, but are removed from the group.`,
				{ modal: true },
				'Delete'
			);
			if (confirm === 'Delete') {
				await manager.deleteGroup(group.id);
			}
		}),

		vscode.commands.registerCommand('tabColorGroups.closeGroup', async (node?: GroupNode) => {
			const group = await resolveGroup(manager, node, 'Close all tabs in which group?');
			if (!group) {
				return;
			}
			const confirm = await vscode.window.showWarningMessage(
				`Close all ${group.memberKeys.length} tab(s) in "${group.name}"?`,
				{ modal: true },
				'Close'
			);
			if (confirm !== 'Close') {
				return;
			}
			const keys = new Set(group.memberKeys);
			const tabsToClose = flattenLiveTabs().filter(tab => {
				const key = getTabKey(tab);
				return key !== undefined && keys.has(key);
			});
			await manager.withPruneSuppressed(keys, () => vscode.window.tabGroups.close(tabsToClose));
			await manager.deleteGroup(group.id);
		}),

		vscode.commands.registerCommand('tabColorGroups.collapseGroup', async (node?: GroupNode) => {
			const group = await resolveGroup(manager, node, 'Collapse which group?');
			if (!group) {
				return;
			}
			const keys = new Set(group.memberKeys);
			const tabsToClose = flattenLiveTabs().filter(tab => {
				const key = getTabKey(tab);
				return key !== undefined && keys.has(key);
			});
			await manager.withPruneSuppressed(keys, () => vscode.window.tabGroups.close(tabsToClose));
			await manager.setCollapsed(group.id, true);
		}),

		vscode.commands.registerCommand('tabColorGroups.expandGroup', async (node?: GroupNode) => {
			const group = await resolveGroup(manager, node, 'Expand which group?');
			if (!group) {
				return;
			}
			for (const key of group.memberKeys) {
				try {
					const uri = vscode.Uri.parse(key);
					await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
				} catch {

				}
			}
			await manager.setCollapsed(group.id, false);
			await organizeTabs(manager);
		}),

		vscode.commands.registerCommand('tabColorGroups.openTab', async (node: TabRef) => {
			if (node.tab) {
				const input = node.tab.input;
				if (input instanceof vscode.TabInputText) {
					await vscode.window.showTextDocument(input.uri, { viewColumn: node.tab.group.viewColumn, preview: false });
					return;
				}
			}
			try {
				const uri = vscode.Uri.parse(node.key);
				await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
			} catch {
				vscode.window.showWarningMessage('Unable to reopen this tab.');
			}
		})
	);
}

export function deactivate() {}
