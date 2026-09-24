import { Regex, type SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	pollInterval: number
	username: string
}

export type ModuleSecrets = {
	password: string
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'textinput',
			id: 'host',
			label: 'Nimbra Edge Host',
			width: 12,
			regex: Regex.HOSTNAME,
		},
		{
			type: 'textinput',
			id: 'username',
			label: 'Username',
			width: 6,
		},
		{
			type: 'secret-text',
			id: 'password',
			label: 'Password',
			width: 6,
		},
		{
			type: 'number',
			id: 'pollInterval',
			label: 'Poll Interval (seconds)',
			width: 6,
			min: 2,
			max: 300,
			default: 5,
		},
	]
}
