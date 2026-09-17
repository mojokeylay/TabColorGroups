import * as vscode from 'vscode';
import { GroupManager, TabGroupRecord, getTabKey } from './groupManager';
import { organizeTabs } from './tabOrganizer';

export class GroupNode {
	readonly type = 'group' as const;
	constructor(public readonly record: TabGroupRecord) {}
}

export class TabNode {
	readonly type = 'tab' as const;
	constructor(public readonly group: TabGroupRecord, public readonly key: string, public readonly tab: vscode.Tab | undefined) {}
}

export class UngroupedNode {
	readonly type = 'ungrouped' as const;
}

export class UngroupedTabNode {
	readonly type = 'ungrouped-tab' as const;
	constructor(public readonly key: string, public readonly tab: vscode.Tab | undefined) {}
}

export interface TabRef {
	key: string;
	tab: vscode.Tab | undefined;
}

export type TreeNode = GroupNode | TabNode | UngroupedNode | UngroupedTabNode;

const DND_MIME_TYPE = 'application/vnd.code.tree.tabcolorgroupsview';

function flattenTabs(): Map<string, vscode.Tab> {
	const map = new Map<string, vscode.Tab>();
	for (const tabGroup of vscode.window.tabGroups.all) {
		for (const tab of tabGroup.tabs) {
			const key = getTabKey(tab);
			if (key) {
				map.set(key, tab);
			}
		}
	}
	return map;
}

function uriFromKey(key: string): vscode.Uri | undefined {
	if (key.startsWith('diff:')) {
		return undefined;
	}
	try {
		return vscode.Uri.parse(key);
	} catch {
		return undefined;
	}
}

function basenameFromKey(key: string): string {
	const uri = uriFromKey(key);
	if (uri) {
		return uri.path.split('/').pop() || uri.toString();
	}
	return key;
}

export class TabGroupsTreeDataProvider implements vscode.TreeDataProvider<TreeNode>, vscode.TreeDragAndDropController<TreeNode> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	readonly dropMimeTypes = [DND_MIME_TYPE];
	readonly dragMimeTypes = [DND_MIME_TYPE];

	constructor(private readonly manager: GroupManager) {
		manager.onDidChange(() => this._onDidChangeTreeData.fire());
		vscode.window.tabGroups.onDidChangeTabs(() => this._onDidChangeTreeData.fire());
		vscode.window.tabGroups.onDidChangeTabGroups(() => this._onDidChangeTreeData.fire());
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	private getUngroupedKeys(): string[] {
		const grouped = new Set(this.manager.getGroups().flatMap(g => g.memberKeys));
		return [...flattenTabs().keys()].filter(key => !grouped.has(key));
	}

	getChildren(element?: TreeNode): TreeNode[] {
		if (!element) {
			const nodes: TreeNode[] = this.manager.getGroups().map(record => new GroupNode(record));
			if (this.getUngroupedKeys().length > 0) {
				nodes.push(new UngroupedNode());
			}
			return nodes;
		}
		if (element.type === 'group') {
			if (element.record.collapsed) {
				return [];
			}
			const liveTabs = flattenTabs();
			return element.record.memberKeys.map(key => new TabNode(element.record, key, liveTabs.get(key)));
		}
		if (element.type === 'ungrouped') {
			const liveTabs = flattenTabs();
			return this.getUngroupedKeys().map(key => new UngroupedTabNode(key, liveTabs.get(key)));
		}
		return [];
	}

	getTreeItem(element: TreeNode): vscode.TreeItem {
		switch (element.type) {
			case 'group':
				return this.buildGroupItem(element.record);
			case 'tab':
				return this.buildTabItem(element.key, element.tab, `${element.group.id}:${element.key}`, 'tab', this.manager.colorFor(element.group.id).themeColorId);
			case 'ungrouped':
				return this.buildUngroupedHeaderItem();
			case 'ungrouped-tab':
				return this.buildTabItem(element.key, element.tab, `ungrouped:${element.key}`, 'ungrouped-tab');
		}
	}

	// Dragging tabs (grouped or ungrouped) within the tree view
	handleDrag(source: readonly TreeNode[], dataTransfer: vscode.DataTransfer): void {
		const keys = source
			.filter((node): node is TabNode | UngroupedTabNode => node.type === 'tab' || node.type === 'ungrouped-tab')
			.map(node => node.key);
		if (keys.length > 0) {
			dataTransfer.set(DND_MIME_TYPE, new vscode.DataTransferItem(keys));
		}
	}

	// Drop tabs in a group or ungrouped section
	async handleDrop(target: TreeNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
		const transferItem = dataTransfer.get(DND_MIME_TYPE);
		if (!transferItem || !target) {
			return;
		}
		const keys: string[] = transferItem.value;
		let groupId: string | undefined;
		let beforeKey: string | undefined;
		if (target.type === 'group') {
			groupId = target.record.id;
		} else if (target.type === 'tab') {
			groupId = target.group.id;
			beforeKey = target.key;
		} else if (target.type !== 'ungrouped' && target.type !== 'ungrouped-tab') {
			return;
		}
		for (const key of keys) {
			if (key === beforeKey) {
				continue;
			}
			if (groupId) {
				await this.manager.addTabToGroup(key, groupId, beforeKey);
			} else {
				await this.manager.removeTabFromGroup(key);
			}
		}
		await organizeTabs(this.manager);
	}

	private buildGroupItem(record: TabGroupRecord): vscode.TreeItem {
		const color = this.manager.colorFor(record.id);
		const collapsibleState = record.collapsed || record.memberKeys.length === 0
			? vscode.TreeItemCollapsibleState.None
			: vscode.TreeItemCollapsibleState.Expanded;
		const item = new vscode.TreeItem(record.name, collapsibleState);
		item.id = record.id;
		item.iconPath = new vscode.ThemeIcon('circle-large-filled', new vscode.ThemeColor(color.themeColorId));
		const count = record.memberKeys.length;
		item.description = `${color.swatch} ${count} tab${count === 1 ? '' : 's'}${record.collapsed ? ' · collapsed' : ''}`;
		item.contextValue = record.collapsed ? 'group-collapsed' : 'group-expanded';
		return item;
	}

	private buildUngroupedHeaderItem(): vscode.TreeItem {
		const item = new vscode.TreeItem('Ungrouped', vscode.TreeItemCollapsibleState.Expanded);
		item.id = '__ungrouped__';
		item.iconPath = new vscode.ThemeIcon('circle-outline');
		const count = this.getUngroupedKeys().length;
		item.description = `${count} tab${count === 1 ? '' : 's'}`;
		item.contextValue = 'ungrouped';
		return item;
	}

	private buildTabItem(key: string, tab: vscode.Tab | undefined, id: string, contextValue: string, themeColorId?: string): vscode.TreeItem {
		const label = tab?.label ?? basenameFromKey(key);
		const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
		item.id = id;
		item.contextValue = contextValue;
		if (themeColorId) {
			item.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(themeColorId));
		} else {
			const uri = uriFromKey(key);
			if (uri) {
				item.resourceUri = uri;
			} else {
				item.iconPath = new vscode.ThemeIcon('file');
			}
		}
		if (!tab) {
			item.description = 'closed';
		}
		const ref: TabRef = { key, tab };
		item.command = {
			command: 'tabColorGroups.openTab',
			title: 'Open Tab',
			arguments: [ref],
		};
		return item;
	}
}

