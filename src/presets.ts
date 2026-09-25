import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'
import { COLOR, variableKey } from './utils.js'
import { ALARM_SEVERITIES, ANY_UNHEALTHY, severityLabel } from './state.js'

export function UpdatePresets(self: ModuleInstance): void {
	const { state } = self
	const variable = (id: string) => `$(${self.label}:${id})`
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}

	const inputs = state.inputChoices()
	const outputs = state.outputChoices()

	for (const { id, label } of inputs) {
		const key = variableKey(id)

		presets[`take_input_${key}`] = {
			type: 'simple',
			name: `Take ${label}`,
			style: { text: label, size: 'auto', color: COLOR.WHITE, bgcolor: COLOR.BLACK },
			steps: [{ down: [{ actionId: 'take_input', options: { input: id } }], up: [] }],
			feedbacks: [
				{
					feedbackId: 'selected_output_source',
					options: { input: id },
					style: { bgcolor: COLOR.GREEN, color: COLOR.WHITE },
				},
			],
		}

		presets[`input_status_${key}`] = {
			type: 'simple',
			name: `${label} status`,
			style: {
				text: `${variable(`input_${key}_name`)}\n${variable(`input_${key}_status`)}`,
				size: 'auto',
				color: COLOR.WHITE,
				bgcolor: COLOR.GREEN,
			},
			steps: [],
			feedbacks: [
				{
					feedbackId: 'input_health',
					options: { input: id, state: ANY_UNHEALTHY },
					style: { bgcolor: COLOR.RED, color: COLOR.WHITE },
				},
			],
		}
	}

	for (const { id, label } of outputs) {
		const key = variableKey(id)

		presets[`select_output_${key}`] = {
			type: 'simple',
			name: `Select ${label}`,
			style: { text: label, size: 'auto', color: COLOR.WHITE, bgcolor: COLOR.BLACK },
			steps: [{ down: [{ actionId: 'select_output', options: { output: id } }], up: [] }],
			feedbacks: [
				{
					feedbackId: 'selected_output',
					options: { output: id },
					style: { bgcolor: COLOR.YELLOW, color: COLOR.BLACK },
				},
			],
		}

		presets[`output_status_${key}`] = {
			type: 'simple',
			name: `${label} status`,
			style: {
				text: `${variable(`output_${key}_name`)}\n${variable(`output_${key}_status`)}`,
				size: 'auto',
				color: COLOR.WHITE,
				bgcolor: COLOR.GREEN,
			},
			steps: [],
			feedbacks: [
				{
					feedbackId: 'output_health',
					options: { output: id, state: ANY_UNHEALTHY },
					style: { bgcolor: COLOR.RED, color: COLOR.WHITE },
				},
			],
		}
	}

	presets.alarms = {
		type: 'simple',
		name: 'Active alarms',
		style: {
			text: `Active Alarms\n${variable('alarm_count')}`,
			size: 'auto',
			color: COLOR.WHITE,
			bgcolor: COLOR.GREEN,
		},
		steps: [],
		feedbacks: [
			{
				feedbackId: 'alarm_active',
				options: { object: '', severity: 'warning' },
				style: { bgcolor: COLOR.YELLOW, color: COLOR.BLACK },
			},
			{
				feedbackId: 'alarm_active',
				options: { object: '', severity: 'major' },
				style: { bgcolor: COLOR.RED, color: COLOR.WHITE },
			},
		],
	}
	for (const severity of ALARM_SEVERITIES) {
		const label = severityLabel(severity)
		const activeStyle =
			severity === 'critical' || severity === 'major'
				? { bgcolor: COLOR.RED, color: COLOR.WHITE }
				: { bgcolor: COLOR.YELLOW, color: COLOR.BLACK }

		presets[`alarm_${severity}`] = {
			type: 'simple',
			name: `${label} alarms`,
			style: {
				text: `${label} Alarms\n${variable(`alarm_${severity}`)}`,
				size: 'auto',
				color: COLOR.WHITE,
				bgcolor: COLOR.BLACK,
			},
			steps: [],
			feedbacks: [
				{
					feedbackId: 'alarm_active',
					options: { object: '', severity },
					style: activeStyle,
				},
			],
		}
	}

	const appliances = state.applianceChoices()
	for (const { id, label } of appliances) {
		const key = variableKey(id)
		presets[`appliance_status_${key}`] = {
			type: 'simple',
			name: `${label} status`,
			style: {
				text: `${variable(`appliance_${key}_name`)}\nCPU ${variable(`appliance_${key}_cpu`)}% MEM ${variable(`appliance_${key}_memory`)}%`,
				size: 'auto',
				color: COLOR.WHITE,
				bgcolor: COLOR.GREEN,
			},
			steps: [],
			feedbacks: [
				{
					feedbackId: 'appliance_usage',
					options: { appliance: id, metric: 'cpu', threshold: 80 },
					style: { bgcolor: COLOR.YELLOW, color: COLOR.BLACK },
				},
				{
					feedbackId: 'appliance_usage',
					options: { appliance: id, metric: 'memory', threshold: 80 },
					style: { bgcolor: COLOR.YELLOW, color: COLOR.BLACK },
				},
				{
					feedbackId: 'appliance_status',
					options: { appliance: id, state: ANY_UNHEALTHY },
					style: { bgcolor: COLOR.RED, color: COLOR.WHITE },
				},
			],
		}
	}

	const structure: CompanionPresetSection<ModuleSchema>[] = [
		{
			id: 'xy_routing',
			name: 'XY routing',
			description: 'Select an output, then take an input to route to it',
			definitions: [
				{
					id: 'xy_inputs',
					type: 'simple',
					name: 'Inputs',
					presets: inputs.map((i) => `take_input_${variableKey(i.id)}`),
				},
				{
					id: 'xy_outputs',
					type: 'simple',
					name: 'Outputs',
					presets: outputs.map((o) => `select_output_${variableKey(o.id)}`),
				},
			],
		},
		{
			id: 'status',
			name: 'Status',
			definitions: [
				{
					id: 'alarms',
					type: 'simple',
					name: 'Alarms',
					presets: ['alarms', ...ALARM_SEVERITIES.map((s) => `alarm_${s}`)],
				},
				{
					id: 'input_status',
					type: 'simple',
					name: 'Inputs',
					presets: inputs.map((i) => `input_status_${variableKey(i.id)}`),
				},
				{
					id: 'output_status',
					type: 'simple',
					name: 'Outputs',
					presets: outputs.map((o) => `output_status_${variableKey(o.id)}`),
				},
				{
					id: 'appliance_status',
					type: 'simple',
					name: 'Appliances',
					presets: appliances.map((a) => `appliance_status_${variableKey(a.id)}`),
				},
			],
		},
	]

	self.setPresetDefinitions(structure, presets)
}
