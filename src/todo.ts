
export class Todo {
	title: string;
	completed: boolean;
	todoistMetadata: { taskId: string, projectId: string, projectName: string };

	constructor(title: string, completed: boolean = false) {
		this.title = title;
		this.completed = completed;
	}
}
