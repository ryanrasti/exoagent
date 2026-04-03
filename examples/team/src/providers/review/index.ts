/**
 * Review provider — code review for agent coding.
 *
 * Owns all review state, UI, and agent plumbing.
 * Depends on pi for listing agents and delivering comments.
 */

import type { BoundEval } from 'exoagent/bound-eval'
import type { PiProviderImpl } from 'exoagent/providers/pi'
import type { ProviderInit } from 'exoagent/provider'
import type Database from 'better-sqlite3'
import type { Review, ReviewFile, Round, Thread, Comment } from './db'
import type { DiffHunk } from './diff-parser'
import z from 'zod'
import { tool } from 'exoagent/exoeval/tool'
import * as db from './db'
import { parseDiffFromPatch } from './diff-parser'

type ReviewCaps = {
	pi: PiProviderImpl
}

type Ring0 = {
	Database: (path: string) => Database.Database
	mkdirSync: (path: string, opts?: { recursive?: boolean }) => void
	readFileSync: (path: string, enc: string) => string
	join: (...args: string[]) => string
	resolve: (...args: string[]) => string
	relative: (...args: string[]) => string
	execSync: (cmd: string, opts: any) => string
	createPatch: (fileName: string, oldStr: string, newStr: string) => string
}

/**
 * Git/file operations that use ring0 instead of direct node imports.
 * This is what runs inside the SES compartment.
 */
const makeGit = (ring0: Ring0) => {
	const execGit = (args: string, cwd: string): string => {
		return (ring0.execSync(`git ${args}`, { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }) as unknown as string).trim()
	}

	return {
		getRepoRoot: (cwd: string) => execGit('rev-parse --show-toplevel', cwd),

		getFileAtRef: (repoRoot: string, filePath: string, ref: string): string | null => {
			try {
				const relPath = ring0.relative(repoRoot, ring0.join(repoRoot, filePath))
				return execGit(`show ${ref}:${relPath}`, repoRoot)
			}
			catch { return null }
		},

		getFileContent: (repoRoot: string, filePath: string): string | null => {
			try { return ring0.readFileSync(ring0.join(repoRoot, filePath), 'utf-8') }
			catch { return null }
		},

		getChangedFiles: (repoRoot: string, ref: string): string[] => {
			let diffFiles: string[] = []
			try { diffFiles = execGit(`diff --name-only ${ref}`, repoRoot).split('\n').filter(l => l.length > 0) }
			catch { /* */ }
			let staged: string[] = []
			try { staged = execGit(`diff --name-only --cached ${ref}`, repoRoot).split('\n').filter(l => l.length > 0) }
			catch { /* */ }
			const untracked = execGit('ls-files --others --exclude-standard', repoRoot).split('\n').filter(l => l.length > 0)
			const all = new Set([...diffFiles, ...staged, ...untracked])
			return [...all].sort()
		},

		parseDiff: (oldContent: string, newContent: string, filePath: string): DiffHunk[] => {
			return parseDiffFromPatch(ring0.createPatch(filePath, oldContent, newContent))
		},
	}
}

// ── Types for cap responses ──────────────────────────────────

export type FileWithDiff = ReviewFile & {
	rounds: Round[]
}

export type ThreadWithComments = Thread & {
	comments: Comment[]
	file_path: string
}

export type ReviewStatus = {
	id: string
	base_ref: string
	total_files: number
	open_threads: number
	addressed_threads: number
	resolved_threads: number
}

export type FileDiff = {
	file_id: string
	path: string
	round_num: number
	old_content: string
	new_content: string
	hunks: DiffHunk[]
}

// ── Scoped ReviewCap (what clients/agents receive) ───────────

export type ReviewProviderImpl = InstanceType<typeof ScopedReview>

class ScopedReview {
	private readonly root: ReviewProvider

	constructor(root: ReviewProvider) {
		this.root = root
	}

	@tool(z.object({
		ref: z.string(),
		repoRoot: z.string(),
		agent: z.object({
			client: z.string(),
			sessionId: z.string(),
		}).optional(),
	}))
	create(opts: { ref: string, repoRoot: string, agent?: { client: string, sessionId: string } }): Review {
		return this.root.createReview(opts)
	}

	@tool(z.string())
	findByRef(ref: string): Review | null {
		return this.root.findByRef(ref)
	}

	@tool()
	list(): Review[] {
		return this.root.listReviews()
	}

	@tool()
	listAgents(): { client: string, sessionId: string, alive: boolean }[] {
		return this.root.listAgents()
	}

	@tool(z.string())
	files(reviewId: string): ReviewFile[] {
		return this.root.files(reviewId)
	}

	@tool(z.string())
	pendingThreads(reviewId: string): ThreadWithComments[] {
		return this.root.pendingThreads(reviewId)
	}

	@tool(z.string(), z.string())
	fileThreads(reviewId: string, fileId: string): ThreadWithComments[] {
		return this.root.fileThreads(reviewId, fileId)
	}

	@tool(z.string(), z.string())
	fileDiff(reviewId: string, fileId: string): FileDiff | null {
		return this.root.fileDiff(reviewId, fileId)
	}

	@tool(z.string())
	status(reviewId: string): ReviewStatus {
		return this.root.status(reviewId)
	}

	@tool(z.string(), z.number(), z.string(), z.string())
	createThread(fileId: string, lineStart: number, body: string, author: string): ThreadWithComments {
		return this.root.createThread(fileId, lineStart, body, author)
	}

	@tool(z.string(), z.string(), z.string())
	reply(threadId: string, body: string, author: string): Comment {
		return this.root.reply(threadId, body, author)
	}

	@tool(z.string())
	address(threadId: string): void {
		this.root.address(threadId)
	}

	@tool(z.string())
	resolve(threadId: string): void {
		this.root.resolve(threadId)
	}

	@tool(z.string())
	reopen(threadId: string): void {
		this.root.reopen(threadId)
	}

	@tool(z.string())
	wontfix(threadId: string): void {
		this.root.wontfix(threadId)
	}

	@tool(z.string(), z.string())
	defer(threadId: string, fileId: string): void {
		this.root.defer(threadId, fileId)
	}
}

// ── Root ReviewProvider ──────────────────────────────────────

class ReviewProvider {
	private readonly database: Database.Database
	private readonly piCap: PiProviderImpl
	private readonly git: ReturnType<typeof makeGit>
	private readonly commentCallbacks: Array<(comment: Comment, thread: Thread, filePath: string) => void> = []

	constructor(database: Database.Database, piCap: PiProviderImpl, ring0: Ring0) {
		this.database = database
		this.piCap = piCap
		this.git = makeGit(ring0)
		db.initSchema(this.database)
	}

	// ── Review lifecycle ─────────────────────────────────────

	createReview(opts: { ref: string, repoRoot: string, agent?: { client: string, sessionId: string } }): Review {
		const repoRoot = this.git.getRepoRoot(opts.repoRoot)
		const review = db.createReview(this.database, {
			baseRef: opts.ref,
			repoRoot,
			agentClient: opts.agent?.client,
			agentSessionId: opts.agent?.sessionId,
		})

		// Add changed files to the review
		const changedFiles = this.git.getChangedFiles(repoRoot, opts.ref)
		for (const filePath of changedFiles) {
			const file = db.addFile(this.database, review.id, filePath)
			// Create initial round with content at base ref
			const baseContent = this.git.getFileAtRef(repoRoot, filePath, opts.ref) ?? ''
			db.createRound(this.database, file.id, 1, baseContent)
		}

		return review
	}

	findByRef(ref: string): Review | null {
		return db.findReviewByRef(this.database, ref)
	}

	listReviews(): Review[] {
		return db.listReviews(this.database)
	}

	listAgents(): { client: string, sessionId: string, alive: boolean }[] {
		try {
			return this.piCap.list() as { client: string, sessionId: string, alive: boolean }[]
		}
		catch {
			return []
		}
	}

	// ── Review content ───────────────────────────────────────

	files(reviewId: string): ReviewFile[] {
		return db.listFiles(this.database, reviewId)
	}

	pendingThreads(reviewId: string): ThreadWithComments[] {
		const threads = db.listPendingThreads(this.database, reviewId)
		return threads.map(t => this.enrichThread(t))
	}

	fileThreads(_reviewId: string, fileId: string): ThreadWithComments[] {
		const rounds = db.listRounds(this.database, fileId)
		const threads: ThreadWithComments[] = []
		for (const round of rounds) {
			for (const t of db.listThreads(this.database, round.id)) {
				threads.push(this.enrichThread(t))
			}
		}
		return threads
	}

	fileDiff(_reviewId: string, fileId: string): FileDiff | null {
		const file = db.getFile(this.database, fileId)
		if (!file) { return null }

		const review = db.getReview(this.database, file.review_id)
		if (!review) { return null }

		const rounds = db.listRounds(this.database, fileId)
		if (rounds.length === 0) { return null }

		// Get the mutable (live) round or the latest frozen round
		const mutableRound = db.getMutableRound(this.database, fileId)
		const targetRound = mutableRound ?? rounds[rounds.length - 1]

		// Old content = base_content of this round
		const oldContent = targetRound.base_content ?? ''

		// New content = current file on disk (for mutable) or snap_content (for frozen)
		const newContent = mutableRound
			? (this.git.getFileContent(review.repo_root, file.path) ?? '')
			: (targetRound.snap_content ?? '')

		const hunks = this.git.parseDiff(oldContent, newContent, file.path)

		return {
			file_id: fileId,
			path: file.path,
			round_num: targetRound.round_num,
			old_content: oldContent,
			new_content: newContent,
			hunks,
		}
	}

	status(reviewId: string): ReviewStatus {
		const review = db.getReview(this.database, reviewId)
		if (!review) { throw new Error(`Review not found: ${reviewId}`) }

		const files = db.listFiles(this.database, reviewId)
		let openThreads = 0
		let addressedThreads = 0
		let resolvedThreads = 0

		for (const file of files) {
			for (const round of db.listRounds(this.database, file.id)) {
				for (const thread of db.listThreads(this.database, round.id)) {
					if (thread.status === 'open') { openThreads++ }
					else if (thread.status === 'addressed') { addressedThreads++ }
					else if (thread.status === 'resolved') { resolvedThreads++ }
				}
			}
		}

		return {
			id: reviewId,
			base_ref: review.base_ref,
			total_files: files.length,
			open_threads: openThreads,
			addressed_threads: addressedThreads,
			resolved_threads: resolvedThreads,
		}
	}

	// ── Thread interaction ───────────────────────────────────

	createThread(fileId: string, lineStart: number, body: string, author: string): ThreadWithComments {
		const file = db.getFile(this.database, fileId)
		if (!file) { throw new Error(`File not found: ${fileId}`) }

		const review = db.getReview(this.database, file.review_id)
		if (!review) { throw new Error(`Review not found for file: ${fileId}`) }

		// Get or create mutable round
		let mutableRound = db.getMutableRound(this.database, fileId)
		if (!mutableRound) {
			// All rounds frozen — shouldn't happen in normal flow
			const rounds = db.listRounds(this.database, fileId)
			const lastRound = rounds[rounds.length - 1]
			const baseContent = lastRound?.snap_content ?? ''
			mutableRound = db.createRound(this.database, fileId, (lastRound?.round_num ?? 0) + 1, baseContent)
		}

		// Freeze the mutable round (first thread added)
		if (mutableRound.snap_content === null) {
			const currentContent = this.git.getFileContent(review.repo_root, file.path) ?? ''
			db.freezeRound(this.database, mutableRound.id, currentContent)

			// Get snippet at the line
			const lines = currentContent.split('\n')
			const snippet = lines.slice(lineStart - 1, lineStart).join('\n')

			const thread = db.createThread(this.database, {
				roundId: mutableRound.id,
				lineStart,
				snippet: snippet || null,
			})

			// Create initial comment
			const comment = db.createComment(this.database, thread.id, body, author)

			// Create new mutable round
			db.createRound(this.database, fileId, mutableRound.round_num + 1, currentContent)

			const result = { ...thread, comments: [comment], file_path: file.path }
			this.notifyComment(comment, thread, file.path)
			return result
		}

		// Round already frozen (additional thread on same round)
		const snapLines = (mutableRound.snap_content ?? '').split('\n')
		const snippet = snapLines.slice(lineStart - 1, lineStart).join('\n')

		const thread = db.createThread(this.database, {
			roundId: mutableRound.id,
			lineStart,
			snippet: snippet || null,
		})

		const comment = db.createComment(this.database, thread.id, body, author)
		const result = { ...thread, comments: [comment], file_path: file.path }
		this.notifyComment(comment, thread, file.path)
		return result
	}

	reply(threadId: string, body: string, author: string): Comment {
		const thread = db.getThread(this.database, threadId)
		if (!thread) { throw new Error(`Thread not found: ${threadId}`) }

		const comment = db.createComment(this.database, threadId, body, author)

		// Look up file path for notification
		const round = db.getRound(this.database, thread.round_id)
		if (round) {
			const file = db.getFile(this.database, round.file_id)
			if (file) {
				this.notifyComment(comment, thread, file.path)
			}
		}

		return comment
	}

	address(threadId: string): void {
		db.addressThread(this.database, threadId)
	}

	resolve(threadId: string): void {
		db.resolveThread(this.database, threadId)
	}

	reopen(threadId: string): void {
		db.reopenThread(this.database, threadId)
	}

	wontfix(threadId: string): void {
		db.wontfixThread(this.database, threadId)
	}

	defer(threadId: string, fileId: string): void {
		const mutableRound = db.getMutableRound(this.database, fileId)
		if (!mutableRound) { throw new Error(`No mutable round for file: ${fileId}`) }
		db.deferThread(this.database, threadId, mutableRound.id)
	}

	// ── Comment notification ─────────────────────────────────

	onComment(callback: (comment: Comment, thread: Thread, filePath: string) => void): void {
		this.commentCallbacks.push(callback)
	}

	private notifyComment(comment: Comment, thread: Thread, filePath: string): void {
		for (const cb of this.commentCallbacks) {
			try { cb(comment, thread, filePath) }
			catch { /* ignore callback errors */ }
		}

		// Deliver to attached agent via pi
		this.deliverToAgent(comment, thread, filePath)
	}

	private deliverToAgent(comment: Comment, thread: Thread, filePath: string): void {
		// Only deliver human comments to agents
		if (comment.author !== 'human') { return }

		const round = db.getRound(this.database, thread.round_id)
		if (!round) { return }
		const file = db.getFile(this.database, round.file_id)
		if (!file) { return }
		const review = db.getReview(this.database, file.review_id)
		if (!review?.agent_client || !review?.agent_session_id) { return }

		const msg = `Review comment on ${filePath}:${thread.line_start}:\n${comment.body}`
		try {
			this.piCap.deliver(review.agent_session_id, 'review', msg)
		}
		catch { /* agent might not be running */ }
	}

	// ── Enrichment helpers ───────────────────────────────────

	private enrichThread(thread: Thread & { comments?: Comment[] }): ThreadWithComments {
		const comments = thread.comments ?? db.listComments(this.database, thread.id)
		const round = db.getRound(this.database, thread.round_id)
		const file = round ? db.getFile(this.database, round.file_id) : null
		return { ...thread, comments, file_path: file?.path ?? '' }
	}

	// ── Provider interface ───────────────────────────────────

	clientProvider(_clientName: string): ScopedReview {
		return new ScopedReview(this)
	}

	uiProvider(_clients: string[]): ScopedReview {
		return new ScopedReview(this)
	}
}

export default (init: ProviderInit<ReviewCaps>) => {
	const ring0 = init.ring0 as Ring0
	const dataDir = init.config.dataDir
	const dbDir = ring0.join(dataDir, 'providers', 'review')
	ring0.mkdirSync(dbDir, { recursive: true })
	const database = ring0.Database(ring0.join(dbDir, 'review.db'))

	const piCap = init.exoEval.run(({ pi }: any) => pi) as PiProviderImpl
	return new ReviewProvider(database, piCap, ring0)
}
