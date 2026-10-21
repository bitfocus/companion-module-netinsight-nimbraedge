import { describe, expect, it } from 'vitest'
import { timeAgo, variableKey } from '../utils.js'

describe('timeAgo', () => {
	const now = Date.parse('2026-01-01T12:00:00Z')

	it('picks the largest whole unit', () => {
		expect(timeAgo('2026-01-01T11:59:55Z', now)).toBe('5s ago')
		expect(timeAgo('2026-01-01T11:57:00Z', now)).toBe('3m ago')
		expect(timeAgo('2026-01-01T10:00:00Z', now)).toBe('2h ago')
		expect(timeAgo('2025-12-28T12:00:00Z', now)).toBe('4d ago')
	})

	it('clamps future times to 0s', () => {
		expect(timeAgo('2026-01-01T12:00:10Z', now)).toBe('0s ago')
	})

	it('handles missing and invalid timestamps', () => {
		expect(timeAgo(undefined, now)).toBe('Never')
		expect(timeAgo('not a date', now)).toBe('')
	})
})

describe('variableKey', () => {
	it('keeps UUIDs and replaces other characters', () => {
		expect(variableKey('3f2a-b1_c')).toBe('3f2a-b1_c')
		expect(variableKey('a.b c/d')).toBe('a_b_c_d')
	})
})
