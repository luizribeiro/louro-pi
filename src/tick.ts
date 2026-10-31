export type Ticker = {
	sleep(ms: number, signal: AbortSignal): Promise<void>;
	warn(line: string): void;
};

/** Runs `tick` every `ms` until `signal` aborts; a tick that throws warns under `label`, and the next one tries again. */
export async function everyTick(
	label: string,
	ms: number,
	tick: () => Promise<unknown>,
	{ sleep, warn }: Ticker,
	signal: AbortSignal,
): Promise<void> {
	while (!signal.aborted) {
		try {
			await tick();
		} catch (error) {
			warn(`! ${label}: ${error}; retrying in ${ms / 1000}s`);
		}
		await sleep(ms, signal);
	}
}
