import { Regex, type SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	port: number
	ignoreCertErrors: boolean
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
			width: 8,
			regex: Regex.HOSTNAME,
		},
		{
			type: 'number',
			id: 'port',
			label: 'HTTPS Port',
			width: 4,
			min: 1,
			max: 65535,
			default: 443,
		},
		{
			type: 'checkbox',
			id: 'ignoreCertErrors',
			label: 'Accept self-signed / untrusted certificates',
			width: 12,
			default: false,
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
