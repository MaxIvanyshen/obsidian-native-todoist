export class State {
	todoistId: string;
	checkboxState: boolean;
	synced: boolean = false; // Whether the state has been synced with Todoist
	retryAttempts: number = 0; // Number of failed sync attempts (used for backoff)

	constructor(todoistId: string, checkboxState: boolean) {
		this.todoistId = todoistId;
		this.checkboxState = checkboxState;
	}

	/** Returns the delay in ms before the next retry, using exponential backoff capped at 5 minutes. */
	nextRetryDelay(): number {
		const base = 5_000; // 5s
		const cap = 5 * 60_000; // 5min
		return Math.min(base * Math.pow(2, this.retryAttempts), cap);
	}
}
