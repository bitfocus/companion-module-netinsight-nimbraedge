import { InstanceStatus } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ModuleConfig, ModuleSecrets } from './config.js'
import { type EdgeAlarm, type EdgeAppliance, type EdgeInput, type EdgeOutput } from './state.js'
import { errorMessage } from './utils.js'

const REQUEST_TIMEOUT_MS = 10_000
const PAGE_SIZE = 200

export type EdgeBuildInfo = {
	buildTime: string
	commit: string
	pipeline: string
	product: string
	release: string
}

export class NimbraEdgeApiError extends Error {
	constructor(
		message: string,
		readonly status: number | null,
	) {
		super(message)
		this.name = 'NimbraEdgeApiError'
	}
}

export class NimbraEdgeApi {
	private baseUrl: string | null = null
	private username = ''
	private password = ''
	private sessionCookie: string | null = null
	// Shared so concurrent requests trigger a single login
	private pendingLogin: Promise<void> | null = null
	private pollTimer: NodeJS.Timeout | null = null
	private pollIntervalMs = 30_000
	private lastStatus: InstanceStatus | null = null
	private lastErrorMessage: string | null = null
	private polling = false
	private generation = 0

	buildInfo: EdgeBuildInfo | null = null

	constructor(private readonly instance: ModuleInstance) {}

	async connect(config: ModuleConfig, secrets: ModuleSecrets): Promise<void> {
		this.stopPolling()
		this.generation++
		this.polling = false
		this.buildInfo = null
		await this.logout()

		const host = config.host?.trim()
		this.username = config.username?.trim() ?? ''
		this.password = secrets.password ?? ''
		this.pollIntervalMs = Math.max(2, config.pollInterval || 5) * 1000

		if (!host) {
			this.baseUrl = null
			this.setStatus(InstanceStatus.BadConfig, 'Host is not set')
			return
		}
		if (!this.username || !this.password) {
			this.baseUrl = null
			this.setStatus(InstanceStatus.BadConfig, 'Username and password are required')
			return
		}

		this.baseUrl = `https://${host}`

		this.setStatus(InstanceStatus.Connecting)
		await this.poll()
		this.startPolling()
	}

	async destroy(): Promise<void> {
		this.stopPolling()
		this.generation++
		await this.logout()
		this.baseUrl = null
	}

	/** Best-effort: failures are only logged */
	private async logout(): Promise<void> {
		if (!this.sessionCookie) return
		try {
			await this.send('POST', '/api/logout/', null, null, true)
			this.instance.log('debug', 'Logged out of Nimbra Edge')
		} catch (e) {
			this.instance.log('debug', `Logout failed: ${errorMessage(e)}`)
		} finally {
			this.sessionCookie = null
		}
	}

	async get<T>(path: string, query: Record<string, unknown> | null): Promise<T> {
		return this.request<T>('GET', path, query, null, true)
	}

	async getAll<T>(path: string, filter: Record<string, unknown>): Promise<T[]> {
		const items: T[] = []
		for (;;) {
			const page = await this.get<{ items: T[]; total: number }>(path, { filter, limit: PAGE_SIZE, skip: items.length })
			items.push(...page.items)
			if (page.items.length === 0 || items.length >= page.total) return items
		}
	}

	async post<T>(path: string, body: unknown): Promise<T> {
		return this.request<T>('POST', path, null, body, true)
	}

	async put<T>(path: string, body: unknown): Promise<T> {
		return this.request<T>('PUT', path, null, body, true)
	}

	async route(outputId: string, inputId: string | null): Promise<EdgeOutput> {
		return this.put<EdgeOutput>(`/api/output/${encodeURIComponent(outputId)}/input`, { input: inputId })
	}

	// Undocumented endpoint used by the Edge web UI
	async restartAppliance(applianceId: string): Promise<void> {
		await this.post(`/api/appliance/${encodeURIComponent(applianceId)}/restart`, null)
	}

	private async request<T>(
		method: string,
		path: string,
		query: Record<string, unknown> | null,
		body: unknown,
		authenticated: boolean,
	): Promise<T> {
		if (!authenticated) return (await this.send<T>(method, path, query, body, false)).data

		await this.validateSession()
		const usedCookie = this.sessionCookie
		try {
			return (await this.send<T>(method, path, query, body, true)).data
		} catch (e) {
			if (!(e instanceof NimbraEdgeApiError) || e.status !== 401) throw e
			// Session expired: retry once, unless another request already replaced the session
			if (this.sessionCookie === usedCookie) this.sessionCookie = null
			await this.validateSession()
			return (await this.send<T>(method, path, query, body, true)).data
		}
	}

	private async validateSession(): Promise<void> {
		if (this.sessionCookie) return
		this.pendingLogin ??= this.login().finally(() => {
			this.pendingLogin = null
		})
		await this.pendingLogin
	}

	private async login(): Promise<void> {
		const { headers } = await this.send(
			'POST',
			'/api/login/',
			null,
			{
				username: this.username,
				password: this.password,
			},
			false,
		)

		const cookie = headers.getSetCookie().find((c) => c.startsWith('edgetoken='))
		if (!cookie) throw new NimbraEdgeApiError('Login succeeded but no session cookie was returned', null)
		this.sessionCookie = cookie.split(';')[0]
		this.instance.log('debug', `Logged in to Nimbra Edge as ${this.username}`)
	}

	private async send<T>(
		method: string,
		path: string,
		query: Record<string, unknown> | null,
		body: unknown,
		authenticated: boolean,
	): Promise<{ data: T; headers: Headers }> {
		if (!this.baseUrl) throw new NimbraEdgeApiError('Not configured', null)

		const url = new URL(path, this.baseUrl)
		// List endpoints take their query as a JSON-encoded `q` param
		if (query) url.searchParams.set('q', JSON.stringify(query))

		const headers: Record<string, string> = { Accept: 'application/json' }
		if (authenticated) headers.Cookie = this.sessionCookie ?? ''
		if (body !== null) headers['Content-Type'] = 'application/json'

		let response: Response
		try {
			response = await fetch(url, {
				method,
				headers,
				body: body !== null ? JSON.stringify(body) : undefined,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			})
		} catch (e) {
			const cause = e instanceof Error && e.cause instanceof Error ? `: ${e.cause.message}` : ''
			const message = e instanceof Error && e.name === 'TimeoutError' ? 'Request timed out' : `${e}${cause}`
			throw new NimbraEdgeApiError(`${method} ${url.pathname} failed - ${message}`, null)
		}

		if (!response.ok) {
			const detail = await response.text().catch(() => '')
			throw new NimbraEdgeApiError(
				`${method} ${url.pathname} returned ${response.status} ${response.statusText}${detail ? ` - ${detail.slice(0, 200)}` : ''}`,
				response.status,
			)
		}

		const text = await response.text()
		return { data: (text ? JSON.parse(text) : undefined) as T, headers: response.headers }
	}

	async poll(): Promise<void> {
		if (this.polling) return
		this.polling = true
		const generation = this.generation
		try {
			if (!this.buildInfo) {
				this.buildInfo = await this.request<EdgeBuildInfo>('GET', '/api/build-info', null, null, false)
				this.instance.log('info', `Connected to Nimbra Edge ${this.buildInfo.release} (${this.buildInfo.product})`)
			}

			const [inputs, outputs, appliances, alarms] = await Promise.all([
				this.getAll<EdgeInput>('/api/input/', { omitMetrics: false }),
				this.getAll<EdgeOutput>('/api/output/', { omitMetrics: false }),
				this.getAll<EdgeAppliance>('/api/appliance/', {}),
				this.getAll<EdgeAlarm>('/api/alarm/', {}),
			])
			if (generation !== this.generation) return // destroyed or reconfigured mid-poll

			this.instance.onStateUpdated({ inputs, outputs, appliances, alarms })
			this.setStatus(InstanceStatus.Ok)
		} catch (e) {
			if (generation === this.generation) this.handleError(e)
		} finally {
			if (generation === this.generation) this.polling = false
		}
	}

	private handleError(e: unknown): void {
		const message = errorMessage(e)

		if (e instanceof NimbraEdgeApiError && (e.status === 401 || e.status === 403)) {
			this.setStatus(InstanceStatus.AuthenticationFailure, 'Login failed - check username and password', message)
		} else if (e instanceof NimbraEdgeApiError && e.status === null) {
			this.buildInfo = null
			this.sessionCookie = null
			this.setStatus(InstanceStatus.ConnectionFailure, 'Unable to reach Nimbra Edge', message)
		} else {
			this.setStatus(InstanceStatus.UnknownError, 'Unexpected response from Nimbra Edge', message)
		}
	}

	// Only logs on change to avoid repeating the same error every poll
	private setStatus(status: InstanceStatus, statusMessage?: string, logMessage?: string): void {
		const errorMessage = logMessage ?? statusMessage ?? null
		if (status === this.lastStatus && errorMessage === this.lastErrorMessage) return

		if (status === InstanceStatus.Ok && this.lastStatus !== null && this.lastStatus !== InstanceStatus.Connecting) {
			this.instance.log('info', 'Connection to Nimbra Edge restored')
		} else if (errorMessage && status !== InstanceStatus.Connecting) {
			this.instance.log('error', errorMessage)
		}

		this.lastStatus = status
		this.lastErrorMessage = errorMessage
		this.instance.updateStatus(status, statusMessage ?? null)
	}

	private startPolling(): void {
		this.pollTimer = setInterval(() => {
			void this.poll()
		}, this.pollIntervalMs)
	}

	private stopPolling(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
		}
	}
}
