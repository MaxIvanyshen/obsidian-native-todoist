import { App, Editor, MarkdownView, Modal, Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, MyPluginSettings, SampleSettingTab } from "./settings";
import { TodoistApi } from "@doist/todoist-api-typescript";
import { processTodoistCodeBlock } from "./codeblock";
import { State } from "./state";

interface PersistedSyncEntry {
	todoistId: string;
	checkboxState: boolean;
	retryAttempts: number;
}

interface PluginData extends MyPluginSettings {
	pendingSyncs: PersistedSyncEntry[];
}

// Extracts the Todoist task ID from a line formatted as: ... (*<id>*)
const TODOIST_ID_REGEX = /\(\*([a-zA-Z0-9]+)\*\)/;
function extractTodoistId(line: string): string | null {
	return line.match(TODOIST_ID_REGEX)?.[1] ?? null;
}

// Remember to rename these classes and interfaces!

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	todoist: TodoistApi;
	taskStates: Record<string, State> = {}; // Map of Todoist task IDs to their last known checkbox state

	async onload() {
		await this.loadSettings();

		this.todoist = new TodoistApi(this.settings.apiKey);
		this.taskStates = {};

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// Register the todoist code block processor
		this.registerMarkdownCodeBlockProcessor("todoist", (source, el, ctx) => {
			processTodoistCodeBlock(source, el, ctx, this.todoist, this.app);
		});

		// Restore any unsynced states persisted on last unload and retry them
		await this.restorePendingSyncs();

		// Listen for metadata cache updates and print checkbox states
		this.registerEvent(
			this.app.metadataCache.on('changed', async (file, data, cache) => {
				const lines = data.split('\n');
				const checkboxes = cache.listItems?.filter(i => i.task !== undefined) ?? [];
				for (const checkbox of checkboxes) {
					const line = lines[checkbox.position.start.line] ?? '';
					let todoistId = extractTodoistId(line);
					if (!todoistId) {
						if (line.contains('#todoist')) { // a new todo just added in obsidian that needs to be synced to Todoist
							const content = line.replace('- [ ]', '').replace('#todoist', '').trim();
							const newTask = await this.todoist.addTask({ content });
							todoistId = newTask.id;
							const projectName = (await this.todoist.getProject(newTask.projectId))?.name ?? 'Inbox';
							const labels = (newTask.labels).map(label => `#todoist/${label}`).join(' ');
							let newLine = line.replace('#todoist', `#todoist/${projectName}`) + labels + ` (*${todoistId}*)`;
							lines[checkbox.position.start.line] = newLine;
							await this.app.vault.modify(file, lines.join('\n'));
						} else {
							// not a todoist task, ignore
							continue;
						}
					}
					this.updateState(todoistId!, checkbox.task == "x");
				}
			})
		);

	}

	onunload() {
		this.savePendingSyncs();
	}

	/** Persist any unsynced states so they survive a plugin reload. */
	savePendingSyncs(): void {
		const pending: PersistedSyncEntry[] = Object.values(this.taskStates)
			.filter(s => !s.synced)
			.map(s => ({ todoistId: s.todoistId, checkboxState: s.checkboxState, retryAttempts: s.retryAttempts }));
		// Fire-and-forget — onunload cannot be async
		this.saveData({ ...this.settings, pendingSyncs: pending } as PluginData);
	}

	/** Restore persisted unsynced states on load and kick off retries. */
	async restorePendingSyncs(): Promise<void> {
		const data = await this.loadData() as Partial<PluginData> | null;
		for (const entry of data?.pendingSyncs ?? []) {
			const state = new State(entry.todoistId, entry.checkboxState);
			state.synced = false;
			state.retryAttempts = entry.retryAttempts;
			this.taskStates[entry.todoistId] = state;
			await this.syncState(state);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MyPluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async updateState(todoistId: string, checkboxState: boolean) {
		let state = this.taskStates[todoistId];
		if (!state) {
			// First time we see this task — snapshot current state as already synced
			state = new State(todoistId, checkboxState);
			state.synced = true;
			this.taskStates[todoistId] = state;
			return;
		}
		if (state.checkboxState !== checkboxState) {
			state.checkboxState = checkboxState;
			state.synced = false;
			state.retryAttempts = 0; // Reset backoff on a fresh user-driven change
		}
		if (state.synced) return;
		await this.syncState(state);
	}

	/** Attempt to sync a state to Todoist. Schedules a retry with exponential backoff on failure. */
	async syncState(state: State): Promise<void> {
		try {
			const todoistTask = await this.todoist.getTask(state.todoistId);
			if (!todoistTask) return; // Task deleted in Todoist — nothing to sync
			if (state.checkboxState && !todoistTask.completedAt) {
				await this.todoist.closeTask(state.todoistId);
			} else if (!state.checkboxState && todoistTask.completedAt) {
				await this.todoist.reopenTask(state.todoistId);
			}
			state.synced = true;
			state.retryAttempts = 0;
		} catch {
			state.retryAttempts++;
			const delay = state.nextRetryDelay();
			new Notice(`Todoist sync failed (attempt ${state.retryAttempts}), retrying in ${Math.round(delay / 1000)}s…`);
			window.setTimeout(() => {
				if (!state.synced) this.syncState(state);
			}, delay);
		}
	}
}

