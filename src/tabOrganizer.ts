import * as vscode from 'vscode';
import { GroupManager, getTabKey } from './groupManager';

async function focusTab(tab: vscode.Tab): Promise<boolean> {
	const input = tab.input;
	try {
		if (input instanceof vscode.TabInputText) {
			await vscode.window.showTextDocument(input.uri, { viewColumn: tab.group.viewColumn, preserveFocus: false, preview: false });
			return true;
		}
		if (input instanceof vscode.TabInputNotebook) {
			const doc = await vscode.workspace.openNotebookDocument(input.uri);
			await vscode.window.showNotebookDocument(doc, { viewColumn: tab.group.viewColumn, preserveFocus: false });
			return true;
		}
	} catch {
		return false;
	}
	return false;
}

// Reoders tabs that are grouped together to mimic the web browser feel
export async function organizeTabs(manager: GroupManager): Promise<void> {
	for (const tabGroup of vscode.window.tabGroups.all) {
		await organizeEditorGroup(tabGroup.viewColumn, manager);
	}
}

async function organizeEditorGroup(viewColumn: vscode.ViewColumn, manager: GroupManager): Promise<void> {
	const groups = manager.getGroups();
	const groupOrderOf = (key: string | undefined) => {
		if (!key) {
			return -1;
		}
		return groups.findIndex(g => g.memberKeys.includes(key));
	};

	const memberOrderOf = (key: string | undefined) => {
		if (!key) {
			return Number.MAX_SAFE_INTEGER;
		}
		for (const group of groups) {
			const index = group.memberKeys.indexOf(key);
			if (index !== -1) {
				return index;
			}
		}
		return Number.MAX_SAFE_INTEGER;
	};

	const initial = vscode.window.tabGroups.all.find(g => g.viewColumn === viewColumn);
	if (!initial) {
		return;
	}

	const desiredKeys = initial.tabs
		.map((tab, index) => ({ key: getTabKey(tab), index, order: groupOrderOf(getTabKey(tab)) }))
		.sort((a, b) => {
			const ag = a.order === -1 ? Number.MAX_SAFE_INTEGER : a.order;
			const bg = b.order === -1 ? Number.MAX_SAFE_INTEGER : b.order;
			if (ag !== bg) {
				return ag - bg;
			}
			const am = memberOrderOf(a.key);
			const bm = memberOrderOf(b.key);
			if (am !== bm) {
				return am - bm;
			}
			return a.index - b.index;
		})
		.map(x => x.key)
		.filter((key): key is string => key !== undefined);

	for (let target = 0; target < desiredKeys.length; target++) {
		const current = vscode.window.tabGroups.all.find(g => g.viewColumn === viewColumn);
		if (!current) {
			return;
		}
		const currentKeys = current.tabs.map(getTabKey);
		const currentIndex = currentKeys.indexOf(desiredKeys[target]);
		if (currentIndex === -1 || currentIndex === target) {
			continue;
		}
		const tab = current.tabs[currentIndex];
		const focused = await focusTab(tab);
		if (!focused) {
			continue;
		}
		await vscode.commands.executeCommand('moveActiveEditor', { to: 'position', by: 'tab', value: target + 1 });
	}
}
