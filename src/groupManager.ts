import * as vscode from 'vscode';
import { getColor, nextColorKey } from './colors';

export interface TabGroupRecord {
	id: string;
	name: string;
	colorKey: string;
	memberKeys: string[];
	collapsed: boolean;
}

interface PersistedState {
	groups: TabGroupRecord[];
}

const STATE_KEY = 'tabColorGroups.state';

export function getTabKey(tab: vscode.Tab): string | undefined {
	const input = tab.input;
	if (input instanceof vscode.TabInputText) {
		return input.uri.toString();
	}
	if (input instanceof vscode.TabInputTextDiff) {
		return `diff:${input.original.toString()}:${input.modified.toString()}`;
	}
	if (input instanceof vscode.TabInputNotebook) {
		return input.uri.toString();
	}
	if (input instanceof vscode.TabInputCustom) {
		return input.uri.toString();
	}
	return undefined;
}

export class GroupManager {
	private groups: TabGroupRecord[];
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;

	private readonly suppressPruneKeys = new Set<string>();

	constructor(private readonly memento: vscode.Memento) {
		const state = memento.get<PersistedState>(STATE_KEY);
		this.groups = state?.groups ?? [];
	}

	getGroups(): readonly TabGroupRecord[] {
		return this.groups;
	}

	getGroup(id: string): TabGroupRecord | undefined {
		return this.groups.find(g => g.id === id);
	}

	findGroupForKey(key: string): TabGroupRecord | undefined {
		return this.groups.find(g => g.memberKeys.includes(key));
	}

	async createGroup(name: string, colorKey?: string): Promise<TabGroupRecord> {
		const record: TabGroupRecord = {
			id: `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			name,
			colorKey: colorKey ?? nextColorKey(this.groups.map(g => g.colorKey)),
			memberKeys: [],
			collapsed: false,
		};
		this.groups.push(record);
		await this.persist();
		return record;
	}

	async renameGroup(id: string, name: string): Promise<void> {
		const group = this.getGroup(id);
		if (!group) {
			return;
		}
		group.name = name;
		await this.persist();
	}

	async setGroupColor(id: string, colorKey: string): Promise<void> {
		const group = this.getGroup(id);
		if (!group) {
			return;
		}
		group.colorKey = colorKey;
		await this.persist();
	}

	async deleteGroup(id: string): Promise<void> {
		this.groups = this.groups.filter(g => g.id !== id);
		await this.persist();
	}

	async addTabToGroup(key: string, groupId: string, beforeKey?: string): Promise<void> {
		for (const group of this.groups) {
			const existingIndex = group.memberKeys.indexOf(key);
			if (existingIndex !== -1) {
				group.memberKeys.splice(existingIndex, 1);
			}
		}
		const target = this.getGroup(groupId);
		if (!target) {
			return;
		}
		const insertIndex = beforeKey ? target.memberKeys.indexOf(beforeKey) : -1;
		if (insertIndex === -1) {
			target.memberKeys.push(key);
		} else {
			target.memberKeys.splice(insertIndex, 0, key);
		}
		await this.persist();
	}

	async removeTabFromGroup(key: string): Promise<void> {
		let changed = false;
		for (const group of this.groups) {
			const index = group.memberKeys.indexOf(key);
			if (index !== -1) {
				group.memberKeys.splice(index, 1);
				changed = true;
			}
		}
		if (changed) {
			await this.persist();
		}
	}

	async setCollapsed(id: string, collapsed: boolean): Promise<void> {
		const group = this.getGroup(id);
		if (!group) {
			return;
		}
		group.collapsed = collapsed;
		await this.persist();
	}

	async pruneClosedTabs(openKeys: ReadonlySet<string>): Promise<void> {
		let changed = false;
		for (const group of this.groups) {
			const kept = group.memberKeys.filter(key => openKeys.has(key) || this.suppressPruneKeys.has(key));
			if (kept.length !== group.memberKeys.length) {
				group.memberKeys = kept;
				changed = true;
			}
		}
		if (changed) {
			await this.persist();
		}
	}

	withPruneSuppressed<T>(keys: Iterable<string>, action: () => Thenable<T>): Promise<T> {
		for (const key of keys) {
			this.suppressPruneKeys.add(key);
		}
		return Promise.resolve(action()).finally(() => {
			setTimeout(() => {
				for (const key of keys) {
					this.suppressPruneKeys.delete(key);
				}
			}, 800);
		});
	}

	colorFor(id: string) {
		const group = this.getGroup(id);
		return getColor(group?.colorKey ?? 'gray');
	}

	private async persist(): Promise<void> {
		await this.memento.update(STATE_KEY, { groups: this.groups } satisfies PersistedState);
		this._onDidChange.fire();
	}
}
