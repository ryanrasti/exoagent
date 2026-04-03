/**
 * Review provider DB layer.
 *
 * All CRUD operations for reviews, files, rounds, threads, and comments.
 * Operates on a better-sqlite3 database instance.
 */

import type Database from 'better-sqlite3'

// ── Types ────────────────────────────────────────────────────

export type Review = {
	id: string
	base_ref: string
	repo_root: string
	agent_client: string | null
	agent_session_id: string | null
	created_at: number
}

export type ReviewFile = {
	id: string
	review_id: string
	path: string
	status: string
}

export type Round = {
	id: string
	file_id: string
	round_num: number
	base_content: string | null
	snap_content: string | null
	created_at: number
}

export type Thread = {
	id: string
	round_id: string
	original_round_id: string
	line_start: number
	line_end: number | null
	snippet: string | null
	status: string
	resolved_at: number | null
	created_at: number
}

export type Comment = {
	id: string
	thread_id: string
	body: string
	author: string
	created_at: number
}

// ── Helpers ──────────────────────────────────────────────────

let idCounter = 0
const generateId = (): string => {
	const ts = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	const seq = (idCounter++).toString(36)
	return `${ts}-${rand}-${seq}`
}

// ── Schema ───────────────────────────────────────────────────

export const initSchema = (db: Database.Database) => {
	db.exec(`
		CREATE TABLE IF NOT EXISTS reviews (
			id TEXT PRIMARY KEY,
			base_ref TEXT NOT NULL,
			repo_root TEXT NOT NULL,
			agent_client TEXT,
			agent_session_id TEXT,
			created_at INTEGER NOT NULL
		)
	`)
	db.exec(`
		CREATE TABLE IF NOT EXISTS review_files (
			id TEXT PRIMARY KEY,
			review_id TEXT NOT NULL REFERENCES reviews(id),
			path TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			UNIQUE(review_id, path)
		)
	`)
	db.exec(`
		CREATE TABLE IF NOT EXISTS rounds (
			id TEXT PRIMARY KEY,
			file_id TEXT NOT NULL REFERENCES review_files(id),
			round_num INTEGER NOT NULL,
			base_content TEXT,
			snap_content TEXT,
			created_at INTEGER NOT NULL,
			UNIQUE(file_id, round_num)
		)
	`)
	db.exec(`
		CREATE TABLE IF NOT EXISTS threads (
			id TEXT PRIMARY KEY,
			round_id TEXT NOT NULL REFERENCES rounds(id),
			original_round_id TEXT NOT NULL REFERENCES rounds(id),
			line_start INTEGER NOT NULL,
			line_end INTEGER,
			snippet TEXT,
			status TEXT NOT NULL DEFAULT 'open',
			resolved_at INTEGER,
			created_at INTEGER NOT NULL
		)
	`)
	db.exec(`
		CREATE TABLE IF NOT EXISTS comments (
			id TEXT PRIMARY KEY,
			thread_id TEXT NOT NULL REFERENCES threads(id),
			body TEXT NOT NULL,
			author TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)
	`)
}

// ── Reviews ──────────────────────────────────────────────────

export const createReview = (db: Database.Database, opts: {
	baseRef: string
	repoRoot: string
	agentClient?: string
	agentSessionId?: string
}): Review => {
	const id = generateId()
	const now = Date.now()
	db.prepare(
		'INSERT INTO reviews (id, base_ref, repo_root, agent_client, agent_session_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
	).run(id, opts.baseRef, opts.repoRoot, opts.agentClient ?? null, opts.agentSessionId ?? null, now)
	return { id, base_ref: opts.baseRef, repo_root: opts.repoRoot, agent_client: opts.agentClient ?? null, agent_session_id: opts.agentSessionId ?? null, created_at: now }
}

export const getReview = (db: Database.Database, id: string): Review | null => {
	return (db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) as Review | undefined) ?? null
}

export const findReviewByRef = (db: Database.Database, baseRef: string): Review | null => {
	return (db.prepare('SELECT * FROM reviews WHERE base_ref = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(baseRef) as Review | undefined) ?? null
}

export const listReviews = (db: Database.Database): Review[] => {
	return db.prepare('SELECT * FROM reviews ORDER BY created_at DESC').all() as Review[]
}

export const attachAgent = (db: Database.Database, reviewId: string, client: string, sessionId: string): void => {
	db.prepare('UPDATE reviews SET agent_client = ?, agent_session_id = ? WHERE id = ?').run(client, sessionId, reviewId)
}

// ── Files ────────────────────────────────────────────────────

export const addFile = (db: Database.Database, reviewId: string, path: string): ReviewFile => {
	const id = generateId()
	db.prepare('INSERT INTO review_files (id, review_id, path) VALUES (?, ?, ?)').run(id, reviewId, path)
	return { id, review_id: reviewId, path, status: 'pending' }
}

export const listFiles = (db: Database.Database, reviewId: string): ReviewFile[] => {
	return db.prepare('SELECT * FROM review_files WHERE review_id = ? ORDER BY path').all(reviewId) as ReviewFile[]
}

export const getFile = (db: Database.Database, fileId: string): ReviewFile | null => {
	return (db.prepare('SELECT * FROM review_files WHERE id = ?').get(fileId) as ReviewFile | undefined) ?? null
}

export const updateFileStatus = (db: Database.Database, fileId: string, status: string): void => {
	db.prepare('UPDATE review_files SET status = ? WHERE id = ?').run(status, fileId)
}

// ── Rounds ───────────────────────────────────────────────────

export const createRound = (db: Database.Database, fileId: string, roundNum: number, baseContent: string | null): Round => {
	const id = generateId()
	const now = Date.now()
	db.prepare('INSERT INTO rounds (id, file_id, round_num, base_content, created_at) VALUES (?, ?, ?, ?, ?)').run(id, fileId, roundNum, baseContent, now)
	return { id, file_id: fileId, round_num: roundNum, base_content: baseContent, snap_content: null, created_at: now }
}

export const getRound = (db: Database.Database, roundId: string): Round | null => {
	return (db.prepare('SELECT * FROM rounds WHERE id = ?').get(roundId) as Round | undefined) ?? null
}

export const listRounds = (db: Database.Database, fileId: string): Round[] => {
	return db.prepare('SELECT * FROM rounds WHERE file_id = ? ORDER BY round_num').all(fileId) as Round[]
}

export const getMutableRound = (db: Database.Database, fileId: string): Round | null => {
	return (db.prepare('SELECT * FROM rounds WHERE file_id = ? AND snap_content IS NULL ORDER BY round_num DESC LIMIT 1').get(fileId) as Round | undefined) ?? null
}

export const freezeRound = (db: Database.Database, roundId: string, snapContent: string): void => {
	db.prepare('UPDATE rounds SET snap_content = ? WHERE id = ?').run(snapContent, roundId)
}

/**
 * Check if a round can be collapsed (all threads resolved/wontfix/deferred away).
 */
export const isRoundCollapsible = (db: Database.Database, roundId: string): boolean => {
	const row = db.prepare(
		'SELECT COUNT(*) as cnt FROM threads WHERE round_id = ? AND status NOT IN (?, ?)',
	).get(roundId, 'resolved', 'wontfix') as { cnt: number }
	return row.cnt === 0
}

// ── Threads ──────────────────────────────────────────────────

export const createThread = (db: Database.Database, opts: {
	roundId: string
	lineStart: number
	lineEnd?: number
	snippet?: string
}): Thread => {
	const id = generateId()
	const now = Date.now()
	db.prepare(
		'INSERT INTO threads (id, round_id, original_round_id, line_start, line_end, snippet, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
	).run(id, opts.roundId, opts.roundId, opts.lineStart, opts.lineEnd ?? null, opts.snippet ?? null, now)
	return {
		id,
		round_id: opts.roundId,
		original_round_id: opts.roundId,
		line_start: opts.lineStart,
		line_end: opts.lineEnd ?? null,
		snippet: opts.snippet ?? null,
		status: 'open',
		resolved_at: null,
		created_at: now,
	}
}

export const getThread = (db: Database.Database, threadId: string): Thread | null => {
	return (db.prepare('SELECT * FROM threads WHERE id = ?').get(threadId) as Thread | undefined) ?? null
}

export const listThreads = (db: Database.Database, roundId: string): Thread[] => {
	return db.prepare('SELECT * FROM threads WHERE round_id = ? ORDER BY line_start').all(roundId) as Thread[]
}

export const listPendingThreads = (db: Database.Database, reviewId: string): (Thread & { comments: Comment[] })[] => {
	const threads = db.prepare(`
		SELECT t.* FROM threads t
		JOIN rounds r ON t.round_id = r.id
		JOIN review_files f ON r.file_id = f.id
		WHERE f.review_id = ? AND t.status IN ('open', 'addressed')
		ORDER BY t.created_at
	`).all(reviewId) as Thread[]
	return threads.map(t => ({
		...t,
		comments: listComments(db, t.id),
	}))
}

export const addressThread = (db: Database.Database, threadId: string): void => {
	db.prepare("UPDATE threads SET status = 'addressed' WHERE id = ? AND status = 'open'").run(threadId)
}

export const resolveThread = (db: Database.Database, threadId: string): void => {
	const now = Date.now()
	db.prepare("UPDATE threads SET status = 'resolved', resolved_at = ? WHERE id = ? AND status IN ('open', 'addressed')").run(now, threadId)
}

export const reopenThread = (db: Database.Database, threadId: string): void => {
	db.prepare("UPDATE threads SET status = 'open', resolved_at = NULL WHERE id = ? AND status = 'addressed'").run(threadId)
}

export const wontfixThread = (db: Database.Database, threadId: string): void => {
	db.prepare("UPDATE threads SET status = 'wontfix' WHERE id = ? AND status IN ('open', 'addressed')").run(threadId)
}

export const deferThread = (db: Database.Database, threadId: string, targetRoundId: string): void => {
	db.prepare('UPDATE threads SET round_id = ? WHERE id = ?').run(targetRoundId, threadId)
}

// ── Comments ─────────────────────────────────────────────────

export const createComment = (db: Database.Database, threadId: string, body: string, author: string): Comment => {
	const id = generateId()
	const now = Date.now()
	db.prepare('INSERT INTO comments (id, thread_id, body, author, created_at) VALUES (?, ?, ?, ?, ?)').run(id, threadId, body, author, now)
	return { id, thread_id: threadId, body, author, created_at: now }
}

export const listComments = (db: Database.Database, threadId: string): Comment[] => {
	return db.prepare('SELECT * FROM comments WHERE thread_id = ? ORDER BY created_at').all(threadId) as Comment[]
}
