#!/usr/bin/env -S npx tsx
/**
 * SaaS Bot Example: Organization -> Project -> Task -> Comment
 *
 * This example demonstrates ExoAgent's capability-based security with a more
 * complex multi-tenant SaaS application structure. The agent can only access
 * data within the organization it's given a capability to.
 *
 * Run: ./examples/saas-bot.ts
 * Or:  npx tsx examples/saas-bot.ts
 */
import type { LanguageModel } from 'ai'
import process from 'node:process'
import { generateText, stepCountIs } from 'ai'
import BetterSqlite3 from 'better-sqlite3'
import { codemode, tool } from 'exoagent'
import { Database } from 'exoagent/sql'
import { SqliteDialect } from 'kysely'
import { getModel, runRepl } from './utils'

// ============================================================================
// Database Setup (in-memory SQLite)
// ============================================================================

const sqlite = new BetterSqlite3(':memory:')

// Migrations
sqlite.exec(`
  CREATE TABLE organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    assignee_id INTEGER REFERENCES users(id),
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'medium',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id),
    author_id INTEGER NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

// Seed data
sqlite.exec(`
  -- Organizations
  INSERT INTO organizations (id, name, slug) VALUES
    (1, 'Acme Corp', 'acme'),
    (2, 'Globex Inc', 'globex');

  -- Users
  INSERT INTO users (id, org_id, name, email, role) VALUES
    (1, 1, 'Alice Admin', 'alice@acme.com', 'admin'),
    (2, 1, 'Bob Builder', 'bob@acme.com', 'member'),
    (3, 1, 'Carol Coder', 'carol@acme.com', 'member'),
    (4, 2, 'Dan Developer', 'dan@globex.com', 'admin'),
    (5, 2, 'Eve Engineer', 'eve@globex.com', 'member');

  -- Projects
  INSERT INTO projects (id, org_id, name, description, status) VALUES
    (1, 1, 'Website Redesign', 'Complete overhaul of the company website', 'active'),
    (2, 1, 'Mobile App', 'iOS and Android app development', 'active'),
    (3, 1, 'API v2', 'New REST API with GraphQL support', 'planning'),
    (4, 2, 'Data Pipeline', 'ETL pipeline for analytics', 'active'),
    (5, 2, 'ML Platform', 'Machine learning infrastructure', 'active');

  -- Tasks
  INSERT INTO tasks (id, project_id, assignee_id, title, description, status, priority) VALUES
    (1, 1, 2, 'Design homepage mockup', 'Create Figma mockups for new homepage', 'in_progress', 'high'),
    (2, 1, 3, 'Implement responsive nav', 'Build mobile-friendly navigation', 'todo', 'medium'),
    (3, 1, 2, 'Set up CI/CD', 'Configure GitHub Actions for deployment', 'done', 'high'),
    (4, 2, 3, 'User authentication', 'Implement OAuth2 login flow', 'in_progress', 'high'),
    (5, 2, 2, 'Push notifications', 'Add FCM for push notifications', 'todo', 'low'),
    (6, 3, NULL, 'API design review', 'Review OpenAPI spec with team', 'todo', 'medium'),
    (7, 4, 4, 'Set up Airflow', 'Install and configure Apache Airflow', 'done', 'high'),
    (8, 4, 5, 'Build data models', 'Create dbt models for warehouse', 'in_progress', 'high'),
    (9, 5, 4, 'GPU cluster setup', 'Provision K8s cluster with GPU nodes', 'todo', 'high'),
    (10, 5, 5, 'Model serving API', 'Build FastAPI service for inference', 'todo', 'medium');

  -- Comments
  INSERT INTO comments (id, task_id, author_id, content) VALUES
    (1, 1, 1, 'Looking great so far! Can we add more contrast?'),
    (2, 1, 2, 'Good point, I will adjust the colors.'),
    (3, 4, 3, 'Should we support social login too?'),
    (4, 4, 1, 'Yes, please add Google and GitHub OAuth.'),
    (5, 7, 4, 'Airflow is running on port 8080.'),
    (6, 8, 5, 'The initial models are ready for review.');
`)

// ============================================================================
// ExoAgent Data Model
// ============================================================================

const db = new Database(new SqliteDialect({ database: sqlite }), { returnExecutedQuery: true })

class Comment extends db.Table('comments').as('comment') {
  id = this.column('id')
  taskId = this.column('task_id')
  authorId = this.column('author_id')
  content = this.column('content')
  createdAt = this.column('created_at')
}

class Task extends db.Table('tasks').as('task') {
  id = this.column('id')
  projectId = this.column('project_id')
  assigneeId = this.column('assignee_id')
  title = this.column('title')
  description = this.column('description')
  status = this.column('status')
  priority = this.column('priority')
  createdAt = this.column('created_at')

  @tool()
  comments() {
    return Comment.on(comment => comment.taskId['='](this.id)).from()
  }
}

class Project extends db.Table('projects').as('project') {
  id = this.column('id')
  orgId = this.column('org_id')
  name = this.column('name')
  description = this.column('description')
  status = this.column('status')
  createdAt = this.column('created_at')

  @tool()
  tasks() {
    return Task.on(task => task.projectId['='](this.id)).from()
  }
}

class User extends db.Table('users').as('member') {
  id = this.column('id')
  orgId = this.column('org_id')
  name = this.column('name')
  email = this.column('email')
  role = this.column('role')
  createdAt = this.column('created_at')

  @tool()
  assignedTasks() {
    return Task.on(task => task.assigneeId['='](this.id)).from()
  }
}

class Organization extends db.Table('organizations').as('org') {
  id = this.column('id')
  name = this.column('name')
  slug = this.column('slug')
  createdAt = this.column('created_at')

  @tool()
  members() {
    return User.on(user => user.orgId['='](this.id)).from()
  }

  @tool()
  projects() {
    return Project.on(project => project.orgId['='](this.id)).from()
  }
}

// ============================================================================
// Chatbot
// ============================================================================

async function chat(userPrompt: string, model: LanguageModel, orgId: number = 1) {
  // Create a capability scoped to the specified organization
  const orgCap = Organization.on(o => o.id['='](orgId)).from()

  // Wrap with codemode for sandboxed execution
  const codeTool = await codemode({
    organization: orgCap,
  }, `class Comment extends db.Table('comments').as('comment') {
  id = this.column('id')
  taskId = this.column('task_id')
  authorId = this.column('author_id')
  content = this.column('content')
  createdAt = this.column('created_at')
}

class Task extends db.Table('tasks').as('task') {
  id = this.column('id')
  projectId = this.column('project_id')
  assigneeId = this.column('assignee_id')
  title = this.column('title')
  description = this.column('description')
  status = this.column('status')
  priority = this.column('priority')
  createdAt = this.column('created_at')

  @tool()
  comments() {
    return Comment.on(comment => comment.taskId['='](this.id)).from()
  }
}

class Project extends db.Table('projects').as('project') {
  id = this.column('id')
  orgId = this.column('org_id')
  name = this.column('name')
  description = this.column('description')
  status = this.column('status')
  createdAt = this.column('created_at')

  @tool()
  tasks() {
    return Task.on(task => task.projectId['='](this.id)).from()
  }
}

class User extends db.Table('users').as('member') {
  id = this.column('id')
  orgId = this.column('org_id')
  name = this.column('name')
  email = this.column('email')
  role = this.column('role')
  createdAt = this.column('created_at')

  @tool()
  assignedTasks() {
    return Task.on(task => task.assigneeId['='](this.id)).from()
  }
}

class Organization extends db.Table('organizations').as('org') {
  id = this.column('id')
  name = this.column('name')
  slug = this.column('slug')
  createdAt = this.column('created_at')

  @tool()
  members() {
    return User.on(user => user.orgId['='](this.id)).from()
  }

  @tool()
  projects() {
    return Project.on(project => project.orgId['='](this.id)).from()
  }
}`)

  const result = await generateText({
    model,
    tools: { execute: codeTool },
    stopWhen: stepCountIs(10),
    system: `You are a helpful project management assistant for a SaaS company.
You have access to the current organization's data including projects, tasks, and team members.

Use the execute tool to query the database. The API provides:
- organization: Returns a query builder for the current org
- org.members(): Returns the org's team members
- org.projects(): Returns the org's projects
- project.tasks(): Returns a project's tasks
- task.comments(): Returns a task's comments

Examples:
- (api) => api.organization.join(({ org }) => org.members()).select(({ member }) => member).execute()
- (api) => api.organization.join(({ org }) => org.projects()).join(({ project }) => project.tasks()).select(({ project, task }) => ({ projectName: project.name, taskName: task.title })).execute()

Select must return a row object (not a flat column).

Always use .execute() at the end of your query chains.`,
    prompt: userPrompt,
  })

  return result
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const { model, name } = await getModel()

  await runRepl({
    title: `ExoAgent SaaS Bot Example [${name}]`,
    context: 'You are in the "Acme Corp" organization (org_id=1)',
    chat: async prompt => await chat(prompt, model),
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

export { chat, Comment, Organization, Project, Task, User }
