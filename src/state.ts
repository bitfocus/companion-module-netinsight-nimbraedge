import type { CompanionInputFieldDropdown, DropdownChoice } from '@companion-module/base'
import { capitalize, itemDropdown } from './utils.js'

export type EdgeHealth = {
	state: string
	title: string
}

export const HEALTH_LABELS: Record<string, string> = {
	allOk: 'OK',
	alarm: 'Alarm',
	inputError: 'Input error',
	outputError: 'Output error',
	transportError: 'Transport error',
	tr101290Priority1Error: 'TR 101 290 priority 1 error',
	reducedRedundancy: 'Reduced redundancy',
	notAcknowledged: 'Not acknowledged',
	metricsMissing: 'Metrics missing',
	notConfigured: 'Not configured',
}

export const INPUT_HEALTH_STATES = [
	'allOk',
	'alarm',
	'inputError',
	'transportError',
	'tr101290Priority1Error',
	'reducedRedundancy',
	'metricsMissing',
	'notConfigured',
]

export const OUTPUT_HEALTH_STATES = [
	'allOk',
	'alarm',
	'inputError',
	'outputError',
	'tr101290Priority1Error',
	'reducedRedundancy',
	'notAcknowledged',
	'metricsMissing',
	'notConfigured',
]

/** The server leaves `title` empty for some states (e.g. allOk) */
function labelFor(health: EdgeHealth | undefined, labels: Record<string, string>): string {
	if (!health) return ''
	return health.title || labels[health.state] || health.state
}

export function healthText(health: EdgeHealth | undefined): string {
	return labelFor(health, HEALTH_LABELS)
}

/** Feedback option: any state other than healthy */
export const ANY_UNHEALTHY = 'unhealthy'

export function matchesHealth(actual: string | undefined, wanted: string, healthyState: string): boolean {
	if (!actual) return false
	return wanted === ANY_UNHEALTHY ? actual !== healthyState : actual === wanted
}

export type EdgePort = {
	mode: string
	srtMode?: string
}

export type EdgeTsPid = {
	streamInfo?: {
		type?: { description?: string }
		video?: {
			frameRate?: number
			interlaced?: string
			videoSize?: { horizontal?: number; vertical?: number }
		}
	}
}

type EdgeEndpoint = {
	id: string
	name: string
	adminStatus: number
	health?: EdgeHealth
	appliances?: { name: string }[]
	ports?: EdgePort[]
	tsInfo?: { pids?: EdgeTsPid[]; services?: { name?: string }[] }[]
}

export type EdgeInput = EdgeEndpoint & {
	numOutputs?: number
}

export type EdgeOutput = EdgeEndpoint & {
	input?: string | null
}

export type EdgeAppliance = {
	id: string
	name: string
	type: string
	health?: EdgeHealth
	metrics?: { cpu?: { usage?: number }; memory?: { usage?: number } }
	region?: { name: string }
	secondaryRegion?: { name: string }
	alarms?: unknown[]
	lastMessageAt?: string
}

export type EdgeSnapshot = {
	inputs: EdgeInput[]
	outputs: EdgeOutput[]
	appliances: EdgeAppliance[]
	alarms: EdgeAlarm[]
}

export type AlarmSeverity = 'critical' | 'major' | 'minor' | 'warning' | 'cleared'

export type EdgeAlarm = {
	id: string | number
	alarmSeverity: AlarmSeverity
	objectName: string
	text?: string
	inputId?: string
	outputId?: string
}

export const ALARM_SEVERITIES: Exclude<AlarmSeverity, 'cleared'>[] = ['critical', 'major', 'minor', 'warning']

export function severityLabel(severity: AlarmSeverity): string {
	return capitalize(severity)
}

const SEVERITY_RANK: Record<AlarmSeverity, number> = { critical: 4, major: 3, minor: 2, warning: 1, cleared: 0 }

export const NO_INPUT = ''
export const NO_INPUT_CHOICE: DropdownChoice<string> = { id: NO_INPUT, label: 'None (disconnected)' }

/** Defaults to the first real input, not "None" */
export function inputDropdownWithNone(
	inputChoices: DropdownChoice<string>[],
): CompanionInputFieldDropdown<'input', string> {
	return { ...itemDropdown('input', 'Input', inputChoices), choices: [NO_INPUT_CHOICE, ...inputChoices] }
}

/** State that feedbacks depend on, used to re-check only affected feedbacks */
export type StateAspect =
	'inputHealth' | 'outputHealth' | 'routing' | 'selection' | 'applianceHealth' | 'applianceUsage' | 'alarms'

export type StateChanges = {
	/** Inputs/outputs/appliances added, removed or renamed */
	structure: boolean
	aspects: Set<StateAspect>
}

function signatures(state: EdgeState): Record<Exclude<StateAspect, 'selection'>, string> {
	const outputs = [...state.outputs.values()]
	const appliances = [...state.appliances.values()]
	return {
		inputHealth: [...state.inputs.values()].map((i) => `${i.id}=${i.health?.state}`).join(),
		outputHealth: outputs.map((o) => `${o.id}=${o.health?.state}`).join(),
		routing: outputs.map((o) => `${o.id}=${o.input}`).join(),
		applianceHealth: appliances.map((a) => `${a.id}=${a.health?.state}`).join(),
		applianceUsage: appliances
			.map((a) => `${a.id}=${usagePercent(a.metrics?.cpu?.usage)}/${usagePercent(a.metrics?.memory?.usage)}`)
			.join(),
		alarms: state.alarms.map((a) => `${a.alarmSeverity}:${a.inputId}:${a.outputId}`).join(),
	}
}

export class EdgeState {
	inputs = new Map<string, EdgeInput>()
	outputs = new Map<string, EdgeOutput>()
	appliances = new Map<string, EdgeAppliance>()
	alarms: EdgeAlarm[] = []
	selectedOutputId: string | null = null
	private alarmCountById = new Map<string, number>()
	private alarmCountBySeverity = new Map<AlarmSeverity, number>()

	update({ inputs, outputs, appliances, alarms }: EdgeSnapshot): StateChanges {
		const before = signatures(this)
		const selectedBefore = this.selectedOutputId
		const structure =
			!sameIdentity(this.inputs, inputs) ||
			!sameIdentity(this.outputs, outputs) ||
			!sameIdentity(this.appliances, appliances)

		this.inputs = new Map(inputs.map((i) => [i.id, i]))
		this.outputs = new Map(outputs.map((o) => [o.id, o]))
		this.appliances = new Map(appliances.map((a) => [a.id, a]))
		this.alarms = alarms.filter((a) => a.alarmSeverity !== 'cleared')

		this.alarmCountById.clear()
		this.alarmCountBySeverity.clear()
		for (const alarm of this.alarms) {
			this.alarmCountBySeverity.set(alarm.alarmSeverity, (this.alarmCountBySeverity.get(alarm.alarmSeverity) ?? 0) + 1)
			for (const id of [alarm.inputId, alarm.outputId]) {
				if (id) this.alarmCountById.set(id, (this.alarmCountById.get(id) ?? 0) + 1)
			}
		}

		if (this.selectedOutputId && !this.outputs.has(this.selectedOutputId)) this.selectedOutputId = null

		const after = signatures(this)
		const aspects = new Set<StateAspect>()
		for (const aspect of Object.keys(after) as (keyof typeof after)[]) {
			if (before[aspect] !== after[aspect]) aspects.add(aspect)
		}
		if (selectedBefore !== this.selectedOutputId) aspects.add('selection')

		return { structure, aspects }
	}

	inputName(id: string | null | undefined): string {
		if (!id) return ''
		return this.inputs.get(id)?.name ?? id
	}

	inputChoices(): DropdownChoice<string>[] {
		return sortedChoices(this.inputs)
	}

	outputChoices(): DropdownChoice<string>[] {
		return sortedChoices(this.outputs)
	}

	applianceChoices(): DropdownChoice<string>[] {
		return sortedChoices(this.appliances)
	}

	/** Updates tallies before the next poll */
	setRoute(outputId: string, inputId: string | null): void {
		const output = this.outputs.get(outputId)
		if (output) output.input = inputId
	}

	offlineApplianceCount(): number {
		let count = 0
		for (const appliance of this.appliances.values()) if (isApplianceOffline(appliance)) count++
		return count
	}

	alarmCountFor(objectId: string): number {
		return this.alarmCountById.get(objectId) ?? 0
	}

	alarmCount(severity: AlarmSeverity): number {
		return this.alarmCountBySeverity.get(severity) ?? 0
	}

	hasAlarmAtLeast(minSeverity: AlarmSeverity, objectId: string | null): boolean {
		return this.alarms.some(
			(a) =>
				SEVERITY_RANK[a.alarmSeverity] >= SEVERITY_RANK[minSeverity] &&
				(!objectId || a.inputId === objectId || a.outputId === objectId),
		)
	}
}

function sameIdentity(current: Map<string, { name: string }>, next: { id: string; name: string }[]): boolean {
	return current.size === next.length && next.every((n) => current.get(n.id)?.name === n.name)
}

function sortedChoices(items: Map<string, { id: string; name: string }>): DropdownChoice<string>[] {
	return [...items.values()]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((item) => ({ id: item.id, label: item.name }))
}

export function applianceNames(item: EdgeEndpoint): string {
	return (item.appliances ?? []).map((a) => a.name).join(', ')
}

/** e.g. "SRT caller", from the first port like the Edge web UI */
export function portType(item: EdgeEndpoint): string {
	const port = item.ports?.[0]
	if (!port) return ''
	return [port.mode.toUpperCase(), port.srtMode].filter(Boolean).join(' ')
}

/** e.g. "H.264 720p50", or "MPTS (3 services) H.264 720p50" */
export function streamFormat(item: EdgeEndpoint): string {
	const formats = new Set<string>()
	let serviceCount = 0

	for (const ts of item.tsInfo ?? []) {
		serviceCount += ts.services?.length ?? 0
		for (const pid of ts.pids ?? []) {
			const info = pid.streamInfo
			if (!info?.video) continue

			// "AVC/H.264 video" -> "H.264"
			const codec = (info.type?.description ?? '')
				.replace(/\s*video$/i, '')
				.split('/')
				.pop()
			const { videoSize, interlaced, frameRate } = info.video
			const scan = interlaced && interlaced !== 'no' ? 'i' : 'p'
			const resolution = videoSize?.vertical ? `${videoSize.vertical}${scan}${frameRate ?? ''}` : ''
			const format = [codec, resolution].filter(Boolean).join(' ')
			if (format) formats.add(format)
		}
	}

	const video = [...formats].join(', ')
	const format = serviceCount > 1 ? [`MPTS (${serviceCount} services)`, video].filter(Boolean).join(' ') : video
	return format || 'N/A'
}

export function serviceNames(item: EdgeEndpoint): string {
	return (item.tsInfo ?? [])
		.flatMap((ts) => ts.services ?? [])
		.map((s) => s.name)
		.filter(Boolean)
		.join(', ')
}

export const APPLIANCE_CONNECTED = 'connected'

export const APPLIANCE_STATUS_LABELS: Record<string, string> = {
	[APPLIANCE_CONNECTED]: 'Connected',
	missing: 'Missing',
	neverConnected: 'Never connected',
}

export function applianceStatus(appliance: EdgeAppliance): string {
	return labelFor(appliance.health, APPLIANCE_STATUS_LABELS)
}

export function isApplianceOffline(appliance: EdgeAppliance): boolean {
	return appliance.health?.state !== APPLIANCE_CONNECTED
}

const APPLIANCE_TYPE_LABELS: Record<string, string> = {
	core: 'Core',
	edgeConnect: 'Edge Connect',
	thumb: 'Core Thumb',
}

export function applianceType(appliance: EdgeAppliance): string {
	return APPLIANCE_TYPE_LABELS[appliance.type] ?? appliance.type
}

export function applianceRegions(appliance: EdgeAppliance): string {
	return [appliance.region?.name, appliance.secondaryRegion?.name].filter(Boolean).join(', ')
}

/** API reports usage as a 0-1 fraction */
export function usagePercent(usage: number | undefined): number | null {
	return typeof usage === 'number' ? Math.round(usage * 100) : null
}
