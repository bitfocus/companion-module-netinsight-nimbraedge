import type ModuleInstance from './main.js'
import { inputDropdownWithNone } from './state.js'
import { itemDropdown } from './utils.js'

export type ActionsSchema = {
	route: {
		options: {
			output: string
			input: string
		}
	}
	select_output: {
		options: {
			output: string
		}
	}
	take_input: {
		options: {
			input: string
		}
	}
	restart_appliance: {
		options: {
			appliance: string
		}
	}
}

export function UpdateActions(self: ModuleInstance): void {
	const inputChoices = self.state.inputChoices()
	const outputChoices = self.state.outputChoices()
	const applianceChoices = self.state.applianceChoices()

	self.setActionDefinitions({
		route: {
			name: 'Route Input to Output',
			options: [inputDropdownWithNone(inputChoices), itemDropdown('output', 'Output', outputChoices)],
			callback: async (event) => {
				await self.routeOutput(event.options.output, event.options.input)
			},
		},
		take_input: {
			name: 'XY: Take Input',
			description: 'Route an input to the selected output',
			options: [inputDropdownWithNone(inputChoices)],
			callback: async (event) => {
				const outputId = self.state.selectedOutputId
				if (!outputId) {
					self.log('warn', 'XY take: no output selected')
					return
				}
				await self.routeOutput(outputId, event.options.input)
			},
		},
		select_output: {
			name: 'XY: Select Output',
			description: 'Select the output that "XY: Take Input" will route to',
			options: [itemDropdown('output', 'Output', outputChoices)],
			callback: (event) => {
				self.selectOutput(event.options.output)
			},
		},
		restart_appliance: {
			name: 'Restart Appliance',
			description: 'Restarts the appliance - streams through it will be interrupted',
			options: [itemDropdown('appliance', 'Appliance', applianceChoices)],
			callback: async (event) => {
				await self.restartAppliance(event.options.appliance)
			},
		},
	})
}
