import type { CompanionInputFieldDropdown, DropdownChoice } from '@companion-module/base'

export const COLOR = {
	WHITE: 0xffffff,
	BLACK: 0x000000,
	RED: 0xcc0000,
	GREEN: 0x009900,
	YELLOW: 0xffcc00,
}

export function errorMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e)
}

export function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Variable ids allow only letters, numbers, `_` and `-`, so Edge UUIDs pass through unchanged */
export function variableKey(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/** e.g. "5s ago", "3m ago", "2h ago", "4d ago" */
export function timeAgo(iso: string | undefined, now: number): string {
	if (!iso) return 'Never'
	const time = Date.parse(iso)
	if (Number.isNaN(time)) return ''
	const seconds = Math.max(0, Math.round((now - time) / 1000))
	if (seconds < 60) return `${seconds}s ago`
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
	return `${Math.floor(seconds / 86400)}d ago`
}

export function itemDropdown<TId extends string>(
	id: TId,
	label: string,
	choices: DropdownChoice<string>[],
): CompanionInputFieldDropdown<TId, string> {
	return { id, type: 'dropdown', label, choices, default: choices[0]?.id ?? '', allowCustom: true }
}
