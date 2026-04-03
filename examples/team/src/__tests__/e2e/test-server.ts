/**
 * Minimal test server for Playwright e2e tests.
 *
 * Spins up a Hono server with the review provider mounted,
 * without requiring the full exoagent daemon + SES.
 */

import type { Server } from 'node:http'
import Database from 'better-sqlite3'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import * as db from '../../providers/review/db'
import * as git from '../../providers/review/git'

export type TestServer = {
	port: number
	server: Server
	db: Database.Database
	repoRoot: string
	close: () => Promise<void>
}

export const startTestServer = (repoRoot: string, port = 0): Promise<TestServer> => {
	const sqliteDb = new Database(':memory:')
	db.initSchema(sqliteDb)

	const app = new Hono()

	// Serve a minimal HTML page
	app.get('/', (c) => {
		return c.html(`<!DOCTYPE html>
<html><head><title>Review Test</title>
<style>body { margin: 0; background: #1a1a1a; color: #e0e0e0; font-family: system-ui; }</style>
</head><body><div id="root"></div>
<script type="module">
// Inline the review UI for testing
const root = document.getElementById('root');

async function rpc(code) {
  const res = await fetch('/rpc', { method: 'POST', body: code });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

window.__rpc = rpc;
window.__renderApp = async function() {
  // Load reviews
  const reviews = await rpc('review.list()');
  if (reviews.length === 0) {
    root.innerHTML = '<div data-testid="picker"><h2>New Code Review</h2>' +
      '<input data-testid="ref-input" value="HEAD" />' +
      '<button data-testid="create-button" onclick="window.__createReview()">Create Review</button>' +
      '<div data-testid="error-message" style="display:none"></div></div>';
    return;
  }
  const reviewId = reviews[0].id;
  const files = await rpc('review.files("' + reviewId + '")');
  let html = '<div data-testid="review-app" style="display:flex;height:100vh">';
  html += '<div data-testid="file-list" style="width:250px;border-right:1px solid #333">';
  html += '<div>Files (' + files.length + ')</div>';
  for (const f of files) {
    html += '<div data-testid="file-item-' + f.path + '" onclick="window.__selectFile(\\'' + f.id + '\\',\\'' + f.path + '\\')" style="padding:8px;cursor:pointer">';
    html += '<span data-testid="file-status-' + f.path + '" style="color:' + (f.status === 'done' ? 'green' : '#888') + '">●</span> ' + f.path;
    html += '</div>';
  }
  html += '</div>';
  html += '<div id="file-content" style="flex:1;padding:16px"><div style="color:#888">Select a file to review</div></div>';
  html += '<div id="thread-sidebar" data-testid="thread-sidebar" style="width:350px;border-left:1px solid #333;padding:12px;display:none"></div>';
  html += '</div>';
  root.innerHTML = html;
};

window.__createReview = async function() {
  try {
    const ref = document.querySelector('[data-testid="ref-input"]').value || 'HEAD';
    await rpc('review.create({ ref: "' + ref + '", repoRoot: "' + ${JSON.stringify(repoRoot)} + '" })');
    await window.__renderApp();
  } catch(e) {
    const el = document.querySelector('[data-testid="error-message"]');
    if (el) { el.style.display = 'block'; el.textContent = e.message; }
  }
};

window.__selectFile = async function(fileId, filePath) {
  const reviewId = (await rpc('review.list()'))[0].id;
  const diff = await rpc('review.fileDiff("' + reviewId + '","' + fileId + '")');
  const threads = await rpc('review.fileThreads("' + reviewId + '","' + fileId + '")');
  let html = '<div data-testid="panels-container">';
  html += '<div data-testid="diff-pane"><h3>' + filePath + '</h3>';
  if (diff && diff.hunks) {
    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        const ln = line.newLineNum || line.oldLineNum || 0;
        const color = line.type === 'add' ? '#4caf50' : line.type === 'remove' ? '#f44' : '#e0e0e0';
        const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
        html += '<div data-testid="diff-line-' + line.type + '-' + ln + '" onclick="window.__commentOnLine(' + ln + ',\\'' + fileId + '\\')" style="cursor:pointer;color:' + color + ';font-family:monospace;padding:1px 12px">' + prefix + line.content + '</div>';
      }
    }
  }
  html += '</div></div>';

  // Threads
  if (threads.length > 0) {
    const sidebar = document.getElementById('thread-sidebar');
    sidebar.style.display = 'block';
    let thtml = '<div style="font-weight:bold;margin-bottom:12px">Threads (' + threads.length + ')</div>';
    for (const t of threads) {
      thtml += '<div data-testid="thread-view-' + t.id + '" style="border:1px solid #333;border-radius:4px;margin-bottom:12px;padding:8px">';
      thtml += '<span data-testid="thread-status-' + t.status + '" style="background:' + (t.status === 'resolved' ? '#2e7d32' : '#1565c0') + ';color:#fff;padding:2px 6px;border-radius:3px;font-size:11px">' + t.status + '</span>';
      thtml += ' ' + filePath + ':' + t.line_start;
      for (const c of t.comments) {
        thtml += '<div data-testid="comment-' + c.id + '" style="margin-top:8px"><b>' + c.author + '</b>: ' + c.body + '</div>';
      }
      if (t.status === 'open' || t.status === 'addressed') {
        thtml += '<div style="margin-top:8px">';
        thtml += '<button data-testid="resolve-button-' + t.id + '" onclick="window.__resolveThread(\\'' + t.id + '\\',\\'' + fileId + '\\',\\'' + filePath + '\\')">Resolve</button> ';
        thtml += '<button data-testid="defer-button-' + t.id + '" onclick="window.__deferThread(\\'' + t.id + '\\',\\'' + fileId + '\\',\\'' + filePath + '\\')">Defer</button>';
        thtml += '</div>';
      }
      thtml += '</div>';
    }
    sidebar.innerHTML = thtml;
  }

  document.getElementById('file-content').innerHTML = html;
  window.__currentFileId = fileId;
  window.__currentFilePath = filePath;
};

window.__commentOnLine = async function(lineNum, fileId) {
  const body = prompt('Comment:');
  if (!body) return;
  const reviewId = (await rpc('review.list()'))[0].id;
  await rpc('review.createThread("' + fileId + '",' + lineNum + ',"' + body.replace(/"/g, '\\\\"') + '","human")');
  await window.__selectFile(fileId, window.__currentFilePath);
};

window.__resolveThread = async function(threadId, fileId, filePath) {
  await rpc('review.resolve("' + threadId + '")');
  await window.__selectFile(fileId, filePath);
};

window.__deferThread = async function(threadId, fileId, filePath) {
  await rpc('review.defer("' + threadId + '","' + fileId + '")');
  await window.__selectFile(fileId, filePath);
};

window.__renderApp();
</script></body></html>`)
	})

	// RPC endpoint — evaluates expressions with review provider in scope
	app.post('/rpc', async (c) => {
		try {
			const code = await c.req.text()
			if (!code.trim()) { return c.json({ error: 'empty' }, 400) }

			// Build a review-like API object
			const review = {
				list: () => db.listReviews(sqliteDb),
				findByRef: (ref: string) => db.findReviewByRef(sqliteDb, ref),
				create: (opts: { ref: string, repoRoot: string, agent?: { client: string, sessionId: string } }) => {
					const repoRootResolved = git.getRepoRoot(opts.repoRoot)
					const r = db.createReview(sqliteDb, {
						baseRef: opts.ref,
						repoRoot: repoRootResolved,
						agentClient: opts.agent?.client,
						agentSessionId: opts.agent?.sessionId,
					})
					const changedFiles = git.getChangedFiles(repoRootResolved, opts.ref)
					for (const filePath of changedFiles) {
						const file = db.addFile(sqliteDb, r.id, filePath)
						const baseContent = git.getFileAtRef(repoRootResolved, filePath, opts.ref) ?? ''
						db.createRound(sqliteDb, file.id, 1, baseContent)
					}
					return r
				},
				files: (reviewId: string) => db.listFiles(sqliteDb, reviewId),
				fileDiff: (reviewId: string, fileId: string) => {
					const file = db.getFile(sqliteDb, fileId)
					if (!file) { return null }
					const r = db.getReview(sqliteDb, file.review_id)
					if (!r) { return null }
					const rounds = db.listRounds(sqliteDb, fileId)
					if (rounds.length === 0) { return null }
					const mutableRound = db.getMutableRound(sqliteDb, fileId)
					const targetRound = mutableRound ?? rounds[rounds.length - 1]
					const oldContent = targetRound.base_content ?? ''
					const newContent = mutableRound
						? (git.getFileContent(r.repo_root, file.path) ?? '')
						: (targetRound.snap_content ?? '')
					const hunks = git.parseDiff(oldContent, newContent, file.path)
					return { file_id: fileId, path: file.path, round_num: targetRound.round_num, old_content: oldContent, new_content: newContent, hunks }
				},
				fileThreads: (reviewId: string, fileId: string) => {
					const rounds = db.listRounds(sqliteDb, fileId)
					const threads: any[] = []
					for (const round of rounds) {
						for (const t of db.listThreads(sqliteDb, round.id)) {
							threads.push({ ...t, comments: db.listComments(sqliteDb, t.id), file_path: '' })
						}
					}
					return threads
				},
				pendingThreads: (reviewId: string) => db.listPendingThreads(sqliteDb, reviewId),
				createThread: (fileId: string, lineStart: number, body: string, author: string) => {
					const file = db.getFile(sqliteDb, fileId)
					if (!file) { throw new Error('file not found') }
					const r = db.getReview(sqliteDb, file.review_id)
					if (!r) { throw new Error('review not found') }
					let mutableRound = db.getMutableRound(sqliteDb, fileId)
					if (!mutableRound) {
						const rounds = db.listRounds(sqliteDb, fileId)
						const last = rounds[rounds.length - 1]
						mutableRound = db.createRound(sqliteDb, fileId, (last?.round_num ?? 0) + 1, last?.snap_content ?? '')
					}
					if (mutableRound.snap_content === null) {
						const content = git.getFileContent(r.repo_root, file.path) ?? ''
						db.freezeRound(sqliteDb, mutableRound.id, content)
						db.createRound(sqliteDb, fileId, mutableRound.round_num + 1, content)
					}
					const thread = db.createThread(sqliteDb, { roundId: mutableRound.id, lineStart })
					db.createComment(sqliteDb, thread.id, body, author)
					return { ...thread, comments: db.listComments(sqliteDb, thread.id) }
				},
				reply: (threadId: string, body: string, author: string) => db.createComment(sqliteDb, threadId, body, author),
				address: (threadId: string) => db.addressThread(sqliteDb, threadId),
				resolve: (threadId: string) => db.resolveThread(sqliteDb, threadId),
				reopen: (threadId: string) => db.reopenThread(sqliteDb, threadId),
				wontfix: (threadId: string) => db.wontfixThread(sqliteDb, threadId),
				defer: (threadId: string, fileId: string) => {
					const mutableRound = db.getMutableRound(sqliteDb, fileId)
					if (!mutableRound) { throw new Error('no mutable round') }
					db.deferThread(sqliteDb, threadId, mutableRound.id)
				},
				status: (reviewId: string) => {
					const r = db.getReview(sqliteDb, reviewId)
					if (!r) { throw new Error('not found') }
					const files = db.listFiles(sqliteDb, reviewId)
					let open = 0, addressed = 0, resolved = 0
					for (const f of files) {
						for (const round of db.listRounds(sqliteDb, f.id)) {
							for (const t of db.listThreads(sqliteDb, round.id)) {
								if (t.status === 'open') { open++ }
								else if (t.status === 'addressed') { addressed++ }
								else if (t.status === 'resolved') { resolved++ }
							}
						}
					}
					return { id: reviewId, base_ref: r.base_ref, total_files: files.length, open_threads: open, addressed_threads: addressed, resolved_threads: resolved }
				},
				listAgents: () => [],
			}

			// Evaluate the expression with review in scope
			const fn = new Function('review', `return ${code}`)
			const result = fn(review)
			const resolved = result instanceof Promise ? await result : result
			return c.json(resolved ?? null)
		}
		catch (err) {
			return c.text(err instanceof Error ? err.message : String(err), 500)
		}
	})

	return new Promise<TestServer>((resolve) => {
		const server = serve({ fetch: app.fetch, port }, (info) => {
			resolve({
				port: info.port,
				server: server as unknown as Server,
				db: sqliteDb,
				repoRoot,
				close: () => new Promise<void>((res) => {
					(server as unknown as Server).close(() => res())
				}),
			})
		})
	})
}
