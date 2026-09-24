import type { CompanionVariableDefinitions } from '@companion-module/base'
import type ModuleInstance from './main.js'
import {
	ALARM_SEVERITIES,
	applianceNames,
	applianceRegions,
	applianceStatus,
	applianceType,
	healthText,
	portType,
	serviceNames,
	streamFormat,
	usagePercent,
} from './state.js'
import { timeAgo, variableKey } from './utils.js'

// Per-item variables are generated at runtime, so can't be listed statically
export type VariablesSchema = {
	[variableId: string]: string | number | undefined
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const { state } = self
	const definitions: CompanionVariableDefinitions<VariablesSchema> = {
		input_count: { name: 'Number of inputs' },
		output_count: { name: 'Number of outputs' },
		appliance_count: { name: 'Number of appliances' },
		appliance_offline_count: { name: 'Number of appliances not connected' },
		alarm_count: { name: 'Number of active alarms' },
		selected_output_name: { name: 'XY: Selected output name' },
		selected_output_source_name: { name: 'XY: Input routed to selected output' },
	}
	for (const severity of ALARM_SEVERITIES) {
		definitions[`alarm_${severity}`] = { name: `Number of active ${severity} alarms` }
	}

	for (const input of state.inputs.values()) {
		const key = variableKey(input.id)
		definitions[`input_${key}_name`] = { name: `Input - ${input.name} - Name` }
		definitions[`input_${key}_status`] = { name: `Input - ${input.name} - Status` }
		definitions[`input_${key}_appliance`] = { name: `Input - ${input.name} - Appliance` }
		definitions[`input_${key}_type`] = { name: `Input - ${input.name} - Type` }
		definitions[`input_${key}_format`] = { name: `Input - ${input.name} - Format` }
		definitions[`input_${key}_services`] = { name: `Input - ${input.name} - Service names` }
		definitions[`input_${key}_enabled`] = { name: `Input - ${input.name} - Enabled` }
		definitions[`input_${key}_alarms`] = { name: `Input - ${input.name} - Active alarms` }
		definitions[`input_${key}_outputs`] = { name: `Input - ${input.name} - Number of outputs` }
	}
	for (const output of state.outputs.values()) {
		const key = variableKey(output.id)
		definitions[`output_${key}_name`] = { name: `Output - ${output.name} - Name` }
		definitions[`output_${key}_status`] = { name: `Output - ${output.name} - Status` }
		definitions[`output_${key}_appliance`] = { name: `Output - ${output.name} - Appliance` }
		definitions[`output_${key}_type`] = { name: `Output - ${output.name} - Type` }
		definitions[`output_${key}_format`] = { name: `Output - ${output.name} - Format` }
		definitions[`output_${key}_services`] = { name: `Output - ${output.name} - Service names` }
		definitions[`output_${key}_enabled`] = { name: `Output - ${output.name} - Enabled` }
		definitions[`output_${key}_alarms`] = { name: `Output - ${output.name} - Active alarms` }
		definitions[`output_${key}_source`] = { name: `Output - ${output.name} - Routed input name` }
	}

	for (const appliance of state.appliances.values()) {
		const key = variableKey(appliance.id)
		definitions[`appliance_${key}_name`] = { name: `Appliance - ${appliance.name} - Name` }
		definitions[`appliance_${key}_status`] = { name: `Appliance - ${appliance.name} - Status` }
		definitions[`appliance_${key}_cpu`] = { name: `Appliance - ${appliance.name} - CPU usage (%)` }
		definitions[`appliance_${key}_memory`] = { name: `Appliance - ${appliance.name} - Memory usage (%)` }
		definitions[`appliance_${key}_type`] = { name: `Appliance - ${appliance.name} - Type` }
		definitions[`appliance_${key}_regions`] = { name: `Appliance - ${appliance.name} - Regions` }
		definitions[`appliance_${key}_alarms`] = { name: `Appliance - ${appliance.name} - Active alarms` }
		definitions[`appliance_${key}_last_seen`] = { name: `Appliance - ${appliance.name} - Last seen` }
	}

	self.setVariableDefinitions(definitions)
}

export function UpdateVariableValues(self: ModuleInstance): void {
	const { state } = self
	const selected = state.selectedOutputId ? state.outputs.get(state.selectedOutputId) : undefined

	const values: VariablesSchema = {
		input_count: state.inputs.size,
		output_count: state.outputs.size,
		appliance_count: state.appliances.size,
		appliance_offline_count: state.offlineApplianceCount(),
		alarm_count: state.alarms.length,
		selected_output_name: selected?.name ?? '',
		selected_output_source_name: state.inputName(selected?.input),
	}
	for (const severity of ALARM_SEVERITIES) {
		values[`alarm_${severity}`] = state.alarmCount(severity)
	}

	for (const input of state.inputs.values()) {
		const key = variableKey(input.id)
		values[`input_${key}_name`] = input.name
		values[`input_${key}_status`] = healthText(input.health)
		values[`input_${key}_appliance`] = applianceNames(input)
		values[`input_${key}_type`] = portType(input)
		values[`input_${key}_format`] = streamFormat(input)
		values[`input_${key}_services`] = serviceNames(input)
		values[`input_${key}_enabled`] = input.adminStatus === 1 ? 'On' : 'Off'
		values[`input_${key}_alarms`] = state.alarmCountFor(input.id)
		values[`input_${key}_outputs`] = input.numOutputs ?? 0
	}
	for (const output of state.outputs.values()) {
		const key = variableKey(output.id)
		values[`output_${key}_name`] = output.name
		values[`output_${key}_status`] = healthText(output.health)
		values[`output_${key}_appliance`] = applianceNames(output)
		values[`output_${key}_type`] = portType(output)
		values[`output_${key}_format`] = streamFormat(output)
		values[`output_${key}_services`] = serviceNames(output)
		values[`output_${key}_enabled`] = output.adminStatus === 1 ? 'On' : 'Off'
		values[`output_${key}_alarms`] = state.alarmCountFor(output.id)
		values[`output_${key}_source`] = state.inputName(output.input)
	}

	const now = Date.now()
	for (const appliance of state.appliances.values()) {
		const key = variableKey(appliance.id)
		values[`appliance_${key}_name`] = appliance.name
		values[`appliance_${key}_status`] = applianceStatus(appliance)
		values[`appliance_${key}_cpu`] = usagePercent(appliance.metrics?.cpu?.usage) ?? 'N/A'
		values[`appliance_${key}_memory`] = usagePercent(appliance.metrics?.memory?.usage) ?? 'N/A'
		values[`appliance_${key}_type`] = applianceType(appliance)
		values[`appliance_${key}_regions`] = applianceRegions(appliance)
		values[`appliance_${key}_alarms`] = appliance.alarms?.length ?? 0
		values[`appliance_${key}_last_seen`] = timeAgo(appliance.lastMessageAt, now)
	}

	setChangedValues(self, values)
}

const sentValues = new WeakMap<ModuleInstance, Map<string, VariablesSchema[string]>>()

function setChangedValues(self: ModuleInstance, values: VariablesSchema): void {
	let sent = sentValues.get(self)
	if (!sent) {
		sent = new Map()
		sentValues.set(self, sent)
	}

	const changed: VariablesSchema = {}
	let hasChanges = false
	for (const [id, value] of Object.entries(values)) {
		if (sent.get(id) === value) continue
		sent.set(id, value)
		changed[id] = value
		hasChanges = true
	}
	if (hasChanges) self.setVariableValues(changed)
}
