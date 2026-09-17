import * as vscode from 'vscode';
import { GroupManager } from './groupManager';


export class TabGroupDecorationProvider implements vscode.FileDecorationProvider {
	private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri[] | undefined>();
	readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

	constructor(private readonly manager: GroupManager, private readonly output: vscode.OutputChannel) {
		this.manager.onDidChange(() => this._onDidChangeFileDecorations.fire(undefined));
		// Tabs restored from the previous session are already rendered before this provider registers,
		// so they never get an initial decoration request. Force one once registration has completed.
		setTimeout(() => this._onDidChangeFileDecorations.fire(undefined), 0);
	}

	provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
		const key = uri.toString();
		const group = this.manager.findGroupForKey(key);
		if (!group) {
			this.output.appendLine(`provideFileDecoration: ${key} -> no group`);
			return undefined;
		}
		const color = this.manager.colorFor(group.id);
		this.output.appendLine(`provideFileDecoration: ${key} -> group "${group.name}" (${color.themeColorId})`);
		const decoration = new vscode.FileDecoration('●', `Tab group: ${group.name}`, new vscode.ThemeColor(color.themeColorId));
		decoration.propagate = false;
		return decoration;
	}
}
