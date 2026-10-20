import { InstanceStatus } from '@companion-module/base'
import { Agent, fetch, type Dispatcher } from 'undici'
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

/** The login itself was rejected, as opposed to an authenticated request being denied */
export class NimbraEdgeAuthError extends NimbraEdgeApiError {
	constructor(message: string, status: number | null) {
		super(message, status)
		this.name = 'NimbraEdgeAuthError'
	}
}

type EdgeTarget = {
	baseUrl: string
	username: string
	password: string
	ignoreCertErrors: boolean
}

/**
 * One login to one server. Each connect() gets a new session, so requests still in flight from a previous config
 * can't log in with old credentials or hand their cookie to the new server.
 */
class EdgeSession {
	private cookie: string | null = null
	// Shared so concurrent requests trigger a single login
	private pendingLogin: Promise<void> | null = null
	private readonly closed = new AbortController()
	private readonly dispatcher: Dispatcher | undefined

	constructor(
		private readonly target: EdgeTarget,
		private readonly instance: ModuleInstance,
	) {
		this.dispatcher = target.ignoreCertErrors ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined
	}

	/** Aborts in-flight requests, then logs out. Best-effort: failures are only logged */
	async close(): Promise<void> {
		this.closed.abort()
		const cookie = this.cookie
		this.cookie = null
		try {
			if (cookie) {
				await this.fetch('POST', '/api/logout/', null, null, cookie, AbortSignal.timeout(REQUEST_TIMEOUT_MS))
				this.instance.log('debug', 'Logged out of Nimbra Edge')
			}
		} catch (e) {
			this.instance.log('debug', `Logout failed: ${errorMessage(e)}`)
		} finally {
			await this.dispatcher?.close()
		}
	}

	/** Forces a fresh login on the next request */
	clearLogin(): void {
		this.cookie = null
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

	async getUnauthenticated<T>(path: string): Promise<T> {
		return this.request<T>('GET', path, null, null, false)
	}

	async post<T>(path: string, body: unknown): Promise<T> {
		return this.request<T>('POST', path, null, body, true)
	}

	async put<T>(path: string, body: unknown): Promise<T> {
		return this.request<T>('PUT', path, null, body, true)
	}

	private async request<T>(
		method: string,
		path: string,
		query: Record<string, unknown> | null,
		body: unknown,
		authenticated: boolean,
	): Promise<T> {
		if (!authenticated) return (await this.send<T>(method, path, query, body, null)).data

		await this.validateSession()
		const usedCookie = this.cookie
		try {
			return (await this.send<T>(method, path, query, body, usedCookie)).data
		} catch (e) {
			if (!(e instanceof NimbraEdgeApiError) || e.status !== 401) throw e
			// Session expired: retry once, unless another request already replaced the session
			if (this.cookie === usedCookie) this.cookie = null
			await this.validateSession()
			return (await this.send<T>(method, path, query, body, this.cookie)).data
		}
	}

	private async validateSession(): Promise<void> {
		if (this.cookie) return
		this.pendingLogin ??= this.login().finally(() => {
			this.pendingLogin = null
		})
		await this.pendingLogin
	}

	private async login(): Promise<void> {
		const { username, password } = this.target
		let response: { headers: Headers }
		try {
			response = await this.send('POST', '/api/login/', null, { username, password }, null)
		} catch (e) {
			if (e instanceof NimbraEdgeApiError && (e.status === 401 || e.status === 403)) {
				throw new NimbraEdgeAuthError(e.message, e.status)
			}
			throw e
		}

		const cookie = response.headers.getSetCookie().find((c) => c.startsWith('edgetoken='))
		if (!cookie) throw new NimbraEdgeApiError('Login succeeded but no session cookie was returned', null)
		this.cookie = cookie.split(';')[0]
		this.instance.log('debug', `Logged in to Nimbra Edge as ${username}`)
	}

	private async send<T>(
		method: string,
		path: string,
		query: Record<string, unknown> | null,
		body: unknown,
		cookie: string | null,
	): Promise<{ data: T; headers: Headers }> {
		if (this.closed.signal.aborted)
			throw new NimbraEdgeApiError(`${method} ${path} cancelled - connection closed`, null)
		const signal = AbortSignal.any([this.closed.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
		return this.fetch<T>(method, path, query, body, cookie, signal)
	}

	private async fetch<T>(
		method: string,
		path: string,
		query: Record<string, unknown> | null,
		body: unknown,
		cookie: string | null,
		signal: AbortSignal,
	): Promise<{ data: T; headers: Headers }> {
		const url = new URL(path, this.target.baseUrl)
		// List endpoints take their query as a JSON-encoded `q` param
		if (query) url.searchParams.set('q', JSON.stringify(query))

		const headers: Record<string, string> = { Accept: 'application/json' }
		if (cookie) headers.Cookie = cookie
		if (body !== null) headers['Content-Type'] = 'application/json'

		let response: Awaited<ReturnType<typeof fetch>>
		try {
			response = await fetch(url, {
				method,
				headers,
				body: body !== null ? JSON.stringify(body) : undefined,
				signal,
				dispatcher: this.dispatcher,
			})
		} catch (e) {
			const cause = e instanceof Error && e.cause instanceof Error ? `: ${e.cause.message}` : ''
			const message = e instanceof Error && e.name === 'TimeoutError' ? 'Request timed out' : `${e}${cause}`
			throw new NimbraEdgeApiError(`${method} ${url.pathname} failed - ${message}`, null)
		}

		if (!response.ok) {
			const detail = await response.text().catch(() => '')
			// HTTP/2 responses have no status text
			const status = [response.status, response.statusText].filter(Boolean).join(' ')
			throw new NimbraEdgeApiError(
				`${method} ${url.pathname} returned ${status}${detail ? ` - ${detail.slice(0, 200)}` : ''}`,
				response.status,
			)
		}

		const text = await response.text()
		return { data: (text ? JSON.parse(text) : undefined) as T, headers: response.headers }
	}
}

export class NimbraEdgeApi {
	private session: EdgeSession | null = null
	private pollTimer: NodeJS.Timeout | null = null
	private lastStatus: InstanceStatus | null = null
	private lastErrorMessage: string | null = null
	private polling = false
	// Logged once per (re)connection, so a server upgrade shows up in the log
	private buildInfoLogged = false

	constructor(private readonly instance: ModuleInstance) {}

	/** Starts polling in the background; the first result arrives via onStateUpdated / the instance status */
	connect(config: ModuleConfig, secrets: ModuleSecrets): void {
		void this.disconnect()

		const host = config.host?.trim()
		const username = config.username?.trim() ?? ''
		const password = secrets.password ?? ''

		if (!host) {
			this.setStatus(InstanceStatus.BadConfig, 'Host is not set', null)
			return
		}
		if (!username || !password) {
			this.setStatus(InstanceStatus.BadConfig, 'Username and password are required', null)
			return
		}

		const port = config.port || 443
		const baseUrl = port === 443 ? `https://${host}` : `https://${host}:${port}`
		this.session = new EdgeSession(
			{ baseUrl, username, password, ignoreCertErrors: !!config.ignoreCertErrors },
			this.instance,
		)

		this.setStatus(InstanceStatus.Connecting, null, null)
		void this.poll()
		const pollIntervalMs = Math.max(2, config.pollInterval || 5) * 1000
		this.pollTimer = setInterval(() => {
			void this.poll()
		}, pollIntervalMs)
	}

	async destroy(): Promise<void> {
		await this.disconnect()
	}

	/** Resolves once the old session has logged out; connect() leaves that to finish in the background */
	private async disconnect(): Promise<void> {
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
		}
		const session = this.session
		this.session = null
		this.polling = false
		this.buildInfoLogged = false
		await session?.close()
	}

	private activeSession(): EdgeSession {
		if (!this.session) throw new NimbraEdgeApiError('Not configured', null)
		return this.session
	}

	async route(outputId: string, inputId: string | null): Promise<EdgeOutput> {
		return this.activeSession().put<EdgeOutput>(`/api/output/${encodeURIComponent(outputId)}/input`, { input: inputId })
	}

	// Undocumented endpoint used by the Edge web UI
	async restartAppliance(applianceId: string): Promise<void> {
		await this.activeSession().post(`/api/appliance/${encodeURIComponent(applianceId)}/restart`, null)
	}

	async poll(): Promise<void> {
		const session = this.session
		if (!session || this.polling) return
		this.polling = true
		try {
			if (!this.buildInfoLogged) {
				this.buildInfoLogged = true
				void this.logBuildInfo(session)
			}

			const [inputs, outputs, appliances, alarms] = await Promise.all([
				session.getAll<EdgeInput>('/api/input/', { omitMetrics: false }),
				session.getAll<EdgeOutput>('/api/output/', { omitMetrics: false }),
				session.getAll<EdgeAppliance>('/api/appliance/', {}),
				session.getAll<EdgeAlarm>('/api/alarm/', {}),
			])
			if (session !== this.session) return // destroyed or reconfigured mid-poll

			this.instance.onStateUpdated({ inputs, outputs, appliances, alarms })
			this.setStatus(InstanceStatus.Ok, null, null)
		} catch (e) {
			if (session === this.session) this.handleError(session, e)
		} finally {
			if (session === this.session) this.polling = false
		}
	}

	/** Only informational, so failures don't affect polling */
	private async logBuildInfo(session: EdgeSession): Promise<void> {
		try {
			const buildInfo = await session.getUnauthenticated<EdgeBuildInfo>('/api/build-info')
			this.instance.log('info', `Connected to Nimbra Edge ${buildInfo.release} (${buildInfo.product})`)
		} catch (e) {
			if (session === this.session)
				this.instance.log('debug', `Unable to read Nimbra Edge build info: ${errorMessage(e)}`)
		}
	}

	private handleError(session: EdgeSession, e: unknown): void {
		const message = errorMessage(e)

		if (e instanceof NimbraEdgeAuthError) {
			this.setStatus(InstanceStatus.AuthenticationFailure, 'Login failed - check username and password', message)
		} else if (e instanceof NimbraEdgeApiError && (e.status === 401 || e.status === 403)) {
			// Logged in, but this user may not read one of the endpoints the module polls
			this.setStatus(InstanceStatus.InsufficientPermissions, "Access denied - check the user's permissions", message)
		} else if (e instanceof NimbraEdgeApiError && e.status === null) {
			this.buildInfoLogged = false
			session.clearLogin()
			this.setStatus(InstanceStatus.ConnectionFailure, 'Unable to reach Nimbra Edge', message)
		} else {
			this.setStatus(InstanceStatus.UnknownError, 'Unexpected response from Nimbra Edge', message)
		}
	}

	// Only logs on change to avoid repeating the same error every poll
	private setStatus(status: InstanceStatus, statusMessage: string | null, logMessage: string | null): void {
		const errorMessage = logMessage ?? statusMessage
		if (status === this.lastStatus && errorMessage === this.lastErrorMessage) return

		if (status === InstanceStatus.Ok && this.lastStatus !== null && this.lastStatus !== InstanceStatus.Connecting) {
			this.instance.log('info', 'Connection to Nimbra Edge restored')
		} else if (errorMessage && status !== InstanceStatus.Connecting) {
			this.instance.log('error', errorMessage)
		}

		this.lastStatus = status
		this.lastErrorMessage = errorMessage
		this.instance.updateStatus(status, statusMessage)
	}
}
