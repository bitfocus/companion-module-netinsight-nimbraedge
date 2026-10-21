import { describe, expect, it } from 'vitest'
import {
	EdgeState,
	matchesHealth,
	portType,
	streamFormat,
	type EdgeAlarm,
	type EdgeAppliance,
	type EdgeInput,
	type EdgeOutput,
	type EdgeSnapshot,
} from '../state.js'

function input(id: string, overrides: Partial<EdgeInput> = {}): EdgeInput {
	return { id, name: `Input ${id}`, adminStatus: 1, health: { state: 'allOk', title: '' }, ...overrides }
}

function output(id: string, overrides: Partial<EdgeOutput> = {}): EdgeOutput {
	return { id, name: `Output ${id}`, adminStatus: 1, health: { state: 'allOk', title: '' }, ...overrides }
}

function appliance(id: string, overrides: Partial<EdgeAppliance> = {}): EdgeAppliance {
	return { id, name: `Appliance ${id}`, type: 'edgeConnect', health: { state: 'connected', title: '' }, ...overrides }
}

function alarm(alarmSeverity: EdgeAlarm['alarmSeverity'], overrides: Partial<EdgeAlarm> = {}): EdgeAlarm {
	return { id: Math.random(), alarmSeverity, objectName: 'obj', ...overrides }
}

function snapshot(overrides: Partial<EdgeSnapshot> = {}): EdgeSnapshot {
	return {
		inputs: [input('i1'), input('i2')],
		outputs: [output('o1', { input: 'i1' })],
		appliances: [appliance('a1')],
		alarms: [],
		...overrides,
	}
}

describe('EdgeState.update', () => {
	it('reports structure and every aspect on the first update', () => {
		const changes = new EdgeState().update(snapshot())
		expect(changes.structure).toBe(true)
		expect(changes.aspects).toEqual(
			new Set(['inputHealth', 'outputHealth', 'routing', 'applianceHealth', 'applianceUsage']),
		)
	})

	it('reports nothing for an identical snapshot', () => {
		const state = new EdgeState()
		state.update(snapshot())
		const changes = state.update(snapshot())
		expect(changes.structure).toBe(false)
		expect(changes.aspects.size).toBe(0)
	})

	it('reports only the aspect that changed', () => {
		const state = new EdgeState()
		state.update(snapshot())
		const changes = state.update(snapshot({ outputs: [output('o1', { input: 'i2' })] }))
		expect(changes.structure).toBe(false)
		expect(changes.aspects).toEqual(new Set(['routing']))
	})

	it('treats a rename as a structure change', () => {
		const state = new EdgeState()
		state.update(snapshot())
		const changes = state.update(snapshot({ inputs: [input('i1', { name: 'Renamed' }), input('i2')] }))
		expect(changes.structure).toBe(true)
	})

	it('ignores usage changes below the displayed percent', () => {
		const state = new EdgeState()
		state.update(snapshot({ appliances: [appliance('a1', { metrics: { cpu: { usage: 0.501 } } })] }))
		const changes = state.update(snapshot({ appliances: [appliance('a1', { metrics: { cpu: { usage: 0.502 } } })] }))
		expect(changes.aspects.has('applianceUsage')).toBe(false)
	})

	it('clears the selected output when it disappears', () => {
		const state = new EdgeState()
		state.update(snapshot())
		state.selectedOutputId = 'o1'
		const changes = state.update(snapshot({ outputs: [] }))
		expect(state.selectedOutputId).toBeNull()
		expect(changes.aspects.has('selection')).toBe(true)
	})
})

describe('EdgeState alarms', () => {
	const state = new EdgeState()
	state.update(
		snapshot({
			alarms: [
				alarm('major', { inputId: 'i1', outputId: 'o1' }),
				alarm('warning', { inputId: 'i1' }),
				alarm('cleared', { inputId: 'i2' }),
			],
		}),
	)

	it('drops cleared alarms', () => {
		expect(state.alarms).toHaveLength(2)
		expect(state.alarmCount('cleared')).toBe(0)
		expect(state.alarmCountFor('i2')).toBe(0)
	})

	it('counts per object and per severity', () => {
		expect(state.alarmCountFor('i1')).toBe(2)
		expect(state.alarmCountFor('o1')).toBe(1)
		expect(state.alarmCount('major')).toBe(1)
		expect(state.alarmCount('warning')).toBe(1)
	})

	it('matches a minimum severity, optionally for one object', () => {
		expect(state.hasAlarmAtLeast('major', null)).toBe(true)
		expect(state.hasAlarmAtLeast('critical', null)).toBe(false)
		expect(state.hasAlarmAtLeast('major', 'o1')).toBe(true)
		expect(state.hasAlarmAtLeast('minor', 'i2')).toBe(false)
	})
})

describe('matchesHealth', () => {
	it('matches an exact state', () => {
		expect(matchesHealth('alarm', 'alarm', 'allOk')).toBe(true)
		expect(matchesHealth('allOk', 'alarm', 'allOk')).toBe(false)
	})

	it('matches any unhealthy state', () => {
		expect(matchesHealth('inputError', 'unhealthy', 'allOk')).toBe(true)
		expect(matchesHealth('allOk', 'unhealthy', 'allOk')).toBe(false)
	})

	it('never matches a missing state', () => {
		expect(matchesHealth(undefined, 'unhealthy', 'allOk')).toBe(false)
	})
})

describe('portType', () => {
	it('labels the first port with its SRT mode', () => {
		expect(portType(input('i1', { ports: [{ mode: 'srt', srtMode: 'caller' }, { mode: 'udp' }] }))).toBe('SRT caller')
	})

	it('falls back to the raw mode', () => {
		expect(portType(input('i1', { ports: [{ mode: 'newMode' }] }))).toBe('newMode')
	})

	it('is empty without ports', () => {
		expect(portType(input('i1'))).toBe('')
	})
})

describe('streamFormat', () => {
	const h264 = {
		streamInfo: {
			type: { description: 'AVC/H.264 video' },
			video: { frameRate: 50, interlaced: 'no', videoSize: { horizontal: 1280, vertical: 720 } },
		},
	}

	it('formats codec, resolution, scan and frame rate', () => {
		expect(streamFormat(input('i1', { tsInfo: [{ pids: [h264] }] }))).toBe('H.264 720p50')
	})

	it('marks interlaced video', () => {
		const pid = { streamInfo: { ...h264.streamInfo, video: { ...h264.streamInfo.video, interlaced: 'tff' } } }
		expect(streamFormat(input('i1', { tsInfo: [{ pids: [pid] }] }))).toBe('H.264 720i50')
	})

	it('prefixes MPTS with the service count and de-duplicates formats', () => {
		const item = input('i1', { tsInfo: [{ pids: [h264, h264], services: [{}, {}, {}] }] })
		expect(streamFormat(item)).toBe('MPTS (3 services) H.264 720p50')
	})

	it('ignores non-video pids and reports N/A without video', () => {
		const audio = { streamInfo: { type: { description: 'AAC audio' } } }
		expect(streamFormat(input('i1', { tsInfo: [{ pids: [audio] }] }))).toBe('N/A')
	})
})
