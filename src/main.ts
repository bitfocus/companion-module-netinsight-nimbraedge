import { InstanceBase, type SomeCompanionConfigField } from '@companion-module/base'
import { NimbraEdgeApi } from './api.js'
import { GetConfigFields, type ModuleConfig, type ModuleSecrets } from './config.js'
import { UpdateVariableDefinitions, UpdateVariableValues, type VariablesSchema } from './variables.js'
import { EdgeState, NO_INPUT, type EdgeSnapshot, type StateAspect } from './state.js'
import { errorMessage } from './utils.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: ModuleSecrets
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

const FEEDBACKS_BY_ASPECT: Record<StateAspect, (keyof FeedbacksSchema)[]> = {
	inputHealth: ['input_health'],
	outputHealth: ['output_health'],
	routing: ['output_routed', 'selected_output_source'],
	selection: ['selected_output', 'selected_output_source'],
	applianceHealth: ['appliance_status'],
	applianceUsage: ['appliance_usage'],
	alarms: ['alarm_active'],
}

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	api = new NimbraEdgeApi(this)
	state = new EdgeState()

	async init(config: ModuleConfig, _isFirstInit: boolean, secrets: ModuleSecrets): Promise<void> {
		this.updateDefinitions()

		await this.api.connect(config, secrets)
	}

	async destroy(): Promise<void> {
		this.log('debug', 'destroy')
		await this.api.destroy()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets): Promise<void> {
		// The server may have changed, so drop its state
		this.state = new EdgeState()
		this.updateDefinitions()
		this.checkAllFeedbacks()

		await this.api.connect(config, secrets)
	}

	onStateUpdated(snapshot: EdgeSnapshot): void {
		const changes = this.state.update(snapshot)
		if (changes.structure) this.updateDefinitions()
		UpdateVariableValues(this)

		if (changes.structure) {
			this.checkAllFeedbacks()
		} else {
			const feedbacks = new Set([...changes.aspects].flatMap((aspect) => FEEDBACKS_BY_ASPECT[aspect]))
			const [first, ...rest] = feedbacks
			if (first) this.checkFeedbacks(first, ...rest)
		}
	}

	async routeOutput(outputId: string, inputId: string): Promise<void> {
		const input = inputId === NO_INPUT ? null : inputId
		const outputName = this.state.outputs.get(outputId)?.name ?? outputId
		try {
			const updated = await this.api.route(outputId, input)
			this.state.setRoute(outputId, updated?.input ?? input)
			this.log('info', `Routed ${input ? this.state.inputName(input) : 'nothing'} to ${outputName}`)
		} catch (e) {
			this.log('error', `Failed to route to ${outputName}: ${errorMessage(e)}`)
			return
		}
		UpdateVariableValues(this)
		this.checkFeedbacks('output_routed', 'selected_output_source')
	}

	async restartAppliance(applianceId: string): Promise<void> {
		const name = this.state.appliances.get(applianceId)?.name ?? applianceId
		try {
			await this.api.restartAppliance(applianceId)
			this.log('info', `Restart requested for appliance ${name}`)
		} catch (e) {
			this.log('error', `Failed to restart appliance ${name}: ${errorMessage(e)}`)
		}
	}

	selectOutput(outputId: string): void {
		this.state.selectedOutputId = outputId
		UpdateVariableValues(this)
		this.checkFeedbacks('selected_output', 'selected_output_source')
	}

	private updateDefinitions(): void {
		UpdateActions(this)
		UpdateFeedbacks(this)
		UpdatePresets(this)
		UpdateVariableDefinitions(this)
	}
}
