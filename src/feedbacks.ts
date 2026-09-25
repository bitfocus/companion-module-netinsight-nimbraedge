import type ModuleInstance from './main.js'
import { COLOR, itemDropdown } from './utils.js'
import {
	ALARM_SEVERITIES,
	ANY_UNHEALTHY,
	APPLIANCE_CONNECTED,
	APPLIANCE_STATUS_LABELS,
	HEALTH_LABELS,
	INPUT_HEALTH_STATES,
	inputDropdownWithNone,
	matchesHealth,
	NO_INPUT,
	OUTPUT_HEALTH_STATES,
	severityLabel,
	usagePercent,
	type AlarmSeverity,
} from './state.js'

const HEALTHY = 'allOk'

export type FeedbacksSchema = {
	appliance_status: {
		type: 'boolean'
		options: {
			appliance: string
			state: string
		}
	}
	appliance_usage: {
		type: 'boolean'
		options: {
			appliance: string
			metric: 'cpu' | 'memory'
			threshold: number
		}
	}
	input_health: {
		type: 'boolean'
		options: {
			input: string
			state: string
		}
	}
	output_health: {
		type: 'boolean'
		options: {
			output: string
			state: string
		}
	}
	output_routed: {
		type: 'boolean'
		options: {
			output: string
			input: string
		}
	}
	selected_output: {
		type: 'boolean'
		options: {
			output: string
		}
	}
	selected_output_source: {
		type: 'boolean'
		options: {
			input: string
		}
	}
	alarm_active: {
		type: 'boolean'
		options: {
			object: string
			severity: AlarmSeverity
		}
	}
}

function stateChoices(states: string[], labels: Record<string, string>, anyLabel: string) {
	return [{ id: ANY_UNHEALTHY, label: anyLabel }, ...states.map((id) => ({ id, label: labels[id] ?? id }))]
}

const INPUT_STATES = stateChoices(INPUT_HEALTH_STATES, HEALTH_LABELS, 'Any unhealthy state')
const OUTPUT_STATES = stateChoices(OUTPUT_HEALTH_STATES, HEALTH_LABELS, 'Any unhealthy state')
const APPLIANCE_STATES = stateChoices(Object.keys(APPLIANCE_STATUS_LABELS), APPLIANCE_STATUS_LABELS, 'Not connected')

export function UpdateFeedbacks(self: ModuleInstance): void {
	const { state } = self
	const inputChoices = state.inputChoices()
	const outputChoices = state.outputChoices()
	const applianceChoices = state.applianceChoices()

	self.setFeedbackDefinitions({
		appliance_status: {
			name: 'Appliance Status',
			type: 'boolean',
			defaultStyle: { bgcolor: COLOR.RED, color: COLOR.WHITE },
			options: [
				itemDropdown('appliance', 'Appliance', applianceChoices),
				{ id: 'state', type: 'dropdown', label: 'State', choices: APPLIANCE_STATES, default: ANY_UNHEALTHY },
			],
			callback: (feedback) =>
				matchesHealth(
					state.appliances.get(feedback.options.appliance)?.health?.state,
					feedback.options.state,
					APPLIANCE_CONNECTED,
				),
		},
		appliance_usage: {
			name: 'Appliance CPU / Memory Above Threshold',
			type: 'boolean',
			defaultStyle: { bgcolor: COLOR.YELLOW, color: COLOR.BLACK },
			options: [
				itemDropdown('appliance', 'Appliance', applianceChoices),
				{
					id: 'metric',
					type: 'dropdown',
					label: 'Metric',
					choices: [
						{ id: 'cpu', label: 'CPU' },
						{ id: 'memory', label: 'Memory' },
					],
					default: 'cpu',
				},
				{ id: 'threshold', type: 'number', label: 'Threshold (%)', default: 80, min: 0, max: 100 },
			],
			callback: (feedback) => {
				const metrics = state.appliances.get(feedback.options.appliance)?.metrics
				const usage = usagePercent(metrics?.[feedback.options.metric]?.usage)
				return usage !== null && usage >= feedback.options.threshold
			},
		},
		input_health: {
			name: 'Input Health State',
			type: 'boolean',
			defaultStyle: { bgcolor: COLOR.RED, color: COLOR.WHITE },
			options: [
				itemDropdown('input', 'Input', inputChoices),
				{ id: 'state', type: 'dropdown', label: 'State', choices: INPUT_STATES, default: ANY_UNHEALTHY },
			],
			callback: (feedback) =>
				matchesHealth(state.inputs.get(feedback.options.input)?.health?.state, feedback.options.state, HEALTHY),
		},
		output_health: {
			name: 'Output Health State',
			type: 'boolean',
			defaultStyle: { bgcolor: COLOR.RED, color: COLOR.WHITE },
			options: [
				itemDropdown('output', 'Output', outputChoices),
				{ id: 'state', type: 'dropdown', label: 'State', choices: OUTPUT_STATES, default: ANY_UNHEALTHY },
			],
			callback: (feedback) =>
				matchesHealth(state.outputs.get(feedback.options.output)?.health?.state, feedback.options.state, HEALTHY),
		},
		output_routed: {
			name: 'Output Routed from Input',
			type: 'boolean',
			defaultStyle: { bgcolor: COLOR.GREEN, color: COLOR.WHITE },
			options: [itemDropdown('output', 'Output', outputChoices), inputDropdownWithNone(inputChoices)],
			callback: (feedback) => {
				const output = state.outputs.get(feedback.options.output)
				return !!output && (output.input ?? NO_INPUT) === feedback.options.input
			},
		},
		selected_output: {
			name: 'XY: Output Selected',
			type: 'boolean',
			defaultStyle: { bgcolor: COLOR.YELLOW, color: COLOR.BLACK },
			options: [itemDropdown('output', 'Output', outputChoices)],
			callback: (feedback) => state.selectedOutputId === feedback.options.output,
		},
		selected_output_source: {
			name: 'XY: Input is routed to selected output',
			type: 'boolean',
			defaultStyle: { bgcolor: COLOR.GREEN, color: COLOR.WHITE },
			options: [itemDropdown('input', 'Input', inputChoices)],
			callback: (feedback) => {
				const output = state.selectedOutputId ? state.outputs.get(state.selectedOutputId) : undefined
				return !!output && output.input === feedback.options.input
			},
		},
		alarm_active: {
			name: 'Alarm Active',
			type: 'boolean',
			defaultStyle: { bgcolor: COLOR.RED, color: COLOR.WHITE },
			options: [
				{
					id: 'object',
					type: 'dropdown',
					label: 'Input / output',
					choices: [
						{ id: '', label: 'Any' },
						...inputChoices.map((c) => ({ id: c.id, label: `Input: ${c.label}` })),
						...outputChoices.map((c) => ({ id: c.id, label: `Output: ${c.label}` })),
					],
					default: '',
					allowCustom: true,
				},
				{
					id: 'severity',
					type: 'dropdown',
					label: 'Minimum severity',
					choices: ALARM_SEVERITIES.map((s) => ({ id: s, label: severityLabel(s) })),
					default: 'warning',
				},
			],
			callback: (feedback) => state.hasAlarmAtLeast(feedback.options.severity, feedback.options.object || null),
		},
	})
}
