import { App, MarkdownPostProcessorContext, TFile } from 'obsidian';
import { TodoistApi, Task } from "@doist/todoist-api-typescript"

export async function processTodoistCodeBlock(
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	todoist: TodoistApi,
	app: App
) {
	// Parse the filter query from the code block
	const lines = source.trim().split('\n');
	let query = 'today | overdue'; // default filter

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith('filter:')) {
			query = trimmed.substring('filter:'.length).trim();
		}
	}

	// Create a container with a button to fetch and insert tasks
	const container = el.createDiv({ cls: 'todoist-tasks-container' });

	const button = container.createEl('button', {
		text: `Insert Todoist tasks (${query})`,
		cls: 'todoist-insert-button'
	});

	button.addEventListener('click', async () => {
		button.disabled = true;
		button.setText('Fetching tasks...');

		try {
			// Fetch tasks from Todoist
			const tasks = await todoist.getTasksByFilter({ query }).then(response => response.results || response);

			if (tasks.length === 0) {
				button.setText('No tasks found');
				setTimeout(() => {
					button.disabled = false;
					button.setText(`Insert Todoist tasks (${query})`);
				}, 2000);
				return;
			}

			// Convert tasks to markdown checkbox format
			let checkboxMarkdown = "";
			for (const task of tasks) {
				const isOverdue = task.due && new Date(task.due.date) < new Date();
				const dueDate = task.due ? ` (🗓️ ${task.due.date.toString()} ${isOverdue ? ` - **OVERDUE**` : ''})` : ''; const tags = (await buildTags(todoist, task)).join(' ');
				checkboxMarkdown += `- [ ] ${task.content} ${tags} ${dueDate} (*${task.id}*)\n`;
			}

			// Get the file and replace the code block with the markdown
			const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
			if (file instanceof TFile) {
				const content = await app.vault.read(file);

				// Find and replace the todoist code block with the markdown
				const codeBlockRegex = /```todoist[\s\S]*?```/;

				const newContent = content.replace(codeBlockRegex, checkboxMarkdown);


				await app.vault.modify(file, newContent);
			}
		} catch (error) {
			button.setText(`Error: ${error}`);
			setTimeout(() => {
				button.disabled = false;
				button.setText("Insert Todoist tasks");
			}, 3000);
		}
	});

	// Add a small info text
	container.createEl('div', {
		text: 'Click to fetch and replace with markdown checkboxes',
		cls: 'todoist-info'
	});
}

async function buildTags(todoist: TodoistApi, task: Task): Promise<string[]> {
	const tags = [];

	const defaultTag = `#todoist`;

	const projectTag = defaultTag + (task.projectId ? "/" + (await todoist.getProject(task.projectId).then(project => project.name)).replace(/\s+/g, '-') : "");
	tags.push(projectTag);
	for (let taskLabel of task.labels) {
		taskLabel = taskLabel.replace(/\s+/g, '-'); // Replace spaces with dashes for Obsidian tag compatibility
		const labelTag = defaultTag + "/" + taskLabel;
		tags.push(labelTag);
	}

	return tags;
}
